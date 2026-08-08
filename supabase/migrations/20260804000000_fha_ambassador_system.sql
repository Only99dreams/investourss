-- FHA: Financial Health Ambassador portal — schema, guard, view, commission RPC
-- Extends profiles, adds ambassador-specific tables and the money logic that the
-- Paystack webhook handler (owned by another team) will invoke via record_ambassador_commission().

-- ============================================================
-- 1. Extend profiles with FHA membership fields
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_active_subscription BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS audit_credits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'individual' CHECK (account_type IN ('individual', 'business'));

-- Index for ambassador look-ups via the referrer chain (profiles.referred_by -> ambassadors.user_id)
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by ON public.profiles (referred_by);

-- ============================================================
-- 2. ambassadors table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ambassadors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  referral_code TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'Star',
  total_earnings NUMERIC(15,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ambassadors_user_id ON public.ambassadors (user_id);

-- ============================================================
-- 3. referrals table (ambassador -> referred user)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_id UUID REFERENCES public.ambassadors(id) ON DELETE CASCADE NOT NULL,
  referred_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'churned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ambassador_id, referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_ambassador_id ON public.referrals (ambassador_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_user_id ON public.referrals (referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON public.referrals (status);

-- ============================================================
-- 4. commissions table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ambassador_id UUID REFERENCES public.ambassadors(id) ON DELETE CASCADE NOT NULL,
  referral_id UUID REFERENCES public.referrals(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  commission_type TEXT NOT NULL CHECK (commission_type IN ('first_time', 'recurring')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commissions_ambassador_id ON public.commissions (ambassador_id);
CREATE INDEX IF NOT EXISTS idx_commissions_referral_id ON public.commissions (referral_id);
CREATE INDEX IF NOT EXISTS idx_commissions_created_at ON public.commissions (created_at DESC);

-- ============================================================
-- 5. Row Level Security
-- ============================================================
ALTER TABLE public.ambassadors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

-- Ambassadors: owner can read/update their own record; admins can read all
DROP POLICY IF EXISTS "Ambassadors can read own record" ON public.ambassadors;
CREATE POLICY "Ambassadors can read own record"
  ON public.ambassadors FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Ambassadors can update own record" ON public.ambassadors;
CREATE POLICY "Ambassadors can update own record"
  ON public.ambassadors FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage all ambassadors" ON public.ambassadors;
CREATE POLICY "Admins can manage all ambassadors"
  ON public.ambassadors FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Referrals: owner can read their own referrals (via their ambassador row); admins all
DROP POLICY IF EXISTS "Ambassadors can read own referrals" ON public.referrals;
CREATE POLICY "Ambassadors can read own referrals"
  ON public.referrals FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.ambassadors am WHERE am.id = ambassador_id AND am.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can manage all referrals" ON public.referrals;
CREATE POLICY "Admins can manage all referrals"
  ON public.referrals FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Commissions: ambassador owns their commissions; admins all
DROP POLICY IF EXISTS "Ambassadors can read own commissions" ON public.commissions;
CREATE POLICY "Ambassadors can read own commissions"
  ON public.commissions FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.ambassadors am WHERE am.id = ambassador_id AND am.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can read all commissions" ON public.commissions;
CREATE POLICY "Admins can read all commissions"
  ON public.commissions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 6. updated_at trigger
-- ============================================================
DROP TRIGGER IF EXISTS update_ambassadors_updated_at ON public.ambassadors;
CREATE TRIGGER update_ambassadors_updated_at BEFORE UPDATE ON public.ambassadors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_referrals_updated_at ON public.referrals;
CREATE TRIGGER update_referrals_updated_at BEFORE UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 7. Guard function: an ambassador must keep an active subscription
--    OR hold audit credits. Used by apply_ambassador() and re-checks.
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_ambassador_eligibility(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_sub BOOLEAN;
  v_credits INTEGER;
BEGIN
  SELECT has_active_subscription, audit_credits
  INTO v_has_sub, v_credits
  FROM profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  RETURN COALESCE(v_has_sub, FALSE) OR COALESCE(v_credits, 0) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.check_ambassador_eligibility(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_ambassador_eligibility(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_ambassador_eligibility(UUID) TO anon;

-- ============================================================
-- 8. Money function: record an ambassador commission for a payment.
--    Called by the payment-success path (Paystack webhook).
--    - p_user_id   : the customer who just paid
--    - p_amount    : gross amount paid (NGN)
--    - p_is_renewal: true = recurring (15%), false = first-time (30%)
--    Idempotent: a referral gets at most ONE first_time commission; any
--    subsequent call routes to recurring even if p_is_renewal=false.
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_ambassador_commission(
  p_user_id UUID,
  p_amount NUMERIC,
  p_is_renewal BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  commission_id UUID,
  amount NUMERIC,
  commission_type TEXT,
  ambassador_id UUID,
  referral_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;         -- the ambassador's user_id
  v_ambassador_id UUID;
  v_ambassador_wallet_id UUID;
  v_referral_id UUID;
  v_commission_id UUID;
  v_commission_type TEXT;
  v_rate NUMERIC;
  v_commission_amount NUMERIC;
  v_first_exists BOOLEAN;
  v_direct_rate NUMERIC := 0.30;     -- 30% first-time
  v_recurring_rate NUMERIC := 0.15;  -- 15% recurring
BEGIN
  -- Resolve who referred the paying customer
  SELECT referred_by INTO v_referrer_id
  FROM profiles
  WHERE id = p_user_id;

  -- That referrer must be an active ambassador
  SELECT id INTO v_ambassador_id
  FROM ambassadors
  WHERE user_id = v_referrer_id
    AND is_active = TRUE;

  IF v_ambassador_id IS NULL THEN
    -- Customer was not referred by an active ambassador; no commission.
    RETURN QUERY SELECT NULL::UUID, 0::NUMERIC, 'none'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  -- Ensure an (active) referral record exists
  INSERT INTO referrals (ambassador_id, referred_user_id, status, created_at)
  VALUES (v_ambassador_id, p_user_id, 'active', now())
  ON CONFLICT (ambassador_id, referred_user_id) DO UPDATE
    SET status = 'active';

  SELECT r.id INTO v_referral_id
  FROM referrals r
  WHERE r.ambassador_id = v_ambassador_id
    AND r.referred_user_id = p_user_id;

  -- Decide commission type.
  -- A referral earns first_time (30%) exactly once; anything after is recurring (15%).
  SELECT EXISTS (
    SELECT 1 FROM commissions c
    WHERE c.referral_id = v_referral_id
      AND c.commission_type = 'first_time'
  ) INTO v_first_exists;

  IF v_first_exists THEN
    v_commission_type := 'recurring';
    v_rate := v_recurring_rate;
  ELSE
    v_commission_type := 'first_time';
    v_rate := v_direct_rate;
  END IF;

  v_commission_amount := COALESCE(p_amount, 0) * v_rate;

  -- Record the commission
  INSERT INTO commissions (ambassador_id, referral_id, amount, commission_type)
  VALUES (v_ambassador_id, v_referral_id, v_commission_amount, v_commission_type)
  RETURNING id INTO v_commission_id;

  -- Mirror into the ambassador's running total
  UPDATE ambassadors
  SET total_earnings = total_earnings + v_commission_amount,
      updated_at = now()
  WHERE id = v_ambassador_id;

  -- Credit the ambassador's wallet (if one exists)
  SELECT id INTO v_ambassador_wallet_id
  FROM wallets
  WHERE user_id = v_referrer_id;

  IF v_ambassador_wallet_id IS NOT NULL AND v_commission_amount > 0 THEN
    UPDATE wallets
    SET user_wallet_balance = user_wallet_balance + v_commission_amount,
        updated_at = now()
    WHERE id = v_ambassador_wallet_id;

    INSERT INTO wallet_transactions (
      wallet_id, amount, transaction_type, narration, source, status
    ) VALUES (
      v_ambassador_wallet_id,
      v_commission_amount,
      'credit',
      'Ambassador ' || v_commission_type || ' commission',
      'ambassador_commission',
      'completed'
    );

    -- Notify the ambassador
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      v_referrer_id,
      'Ambassador Commission Earned!',
      'You earned ₦' || v_commission_amount::TEXT || ' (' || v_commission_type || ') from a referred subscription.',
      'ambassador_commission'
    );
  END IF;

  RETURN QUERY
    SELECT v_commission_id, v_commission_amount, v_commission_type, v_ambassador_id, v_referral_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN) TO anon;

-- ============================================================
-- 9. ambassador_stats view
--    "Active" = referral whose referred user still has an active
--    subscription (the live source of truth; referrals.status is
--    kept in sync by the payment path / churn webhook).
--    Subquery pattern avoids fan-out between referrals and commissions.
-- ============================================================
CREATE OR REPLACE VIEW public.ambassador_stats AS
SELECT
  a.id AS ambassador_id,
  a.user_id,
  a.referral_code,
  a.tier,
  a.total_earnings AS lifetime_earnings,
  a.is_active,
  p.full_name,
  p.email,
  (SELECT COUNT(*)
   FROM public.referrals r
   JOIN public.profiles rp ON rp.id = r.referred_user_id
   WHERE r.ambassador_id = a.id
     AND r.status = 'active'
     AND rp.account_type = 'business'
     AND rp.has_active_subscription = TRUE) AS active_businesses,
  (SELECT COUNT(*)
   FROM public.referrals r
   JOIN public.profiles rp ON rp.id = r.referred_user_id
   WHERE r.ambassador_id = a.id
     AND r.status = 'active'
     AND rp.account_type = 'individual'
     AND rp.has_active_subscription = TRUE) AS active_individuals,
  (SELECT COALESCE(SUM(c.amount), 0)
   FROM public.commissions c
   WHERE c.ambassador_id = a.id
     AND c.created_at >= date_trunc('month', now())) AS monthly_commission
FROM public.ambassadors a
JOIN public.profiles p ON p.id = a.user_id;

GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON public.ambassador_stats TO anon;
GRANT SELECT ON public.ambassador_stats TO authenticated;

-- ============================================================
-- 10. ambassador leaderboard RPC (SECURITY DEFINER so it bypasses
--     per-row RLS, mirroring get_tutor_leaderboard). No-arg so the
--     frontend can call supabase.rpc('get_ambassador_leaderboard')
--     cleanly; returns the top 20 by monthly commission.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_ambassador_leaderboard()
RETURNS TABLE (
  rank INTEGER,
  ambassador_id UUID,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  referral_code TEXT,
  tier TEXT,
  total_earnings NUMERIC,
  active_businesses BIGINT,
  active_individuals BIGINT,
  monthly_commission NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY monthly_commission DESC, lifetime_earnings DESC) AS rank,
    ambassador_id,
    user_id,
    full_name,
    email,
    referral_code,
    tier,
    lifetime_earnings AS total_earnings,
    active_businesses,
    active_individuals,
    monthly_commission
  FROM public.ambassador_stats
  ORDER BY monthly_commission DESC, total_earnings DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.get_ambassador_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ambassador_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ambassador_leaderboard() TO anon;

-- ============================================================
-- 11. Override the legacy subscription-referral trigger so it does
--     NOT double-pay an ambassador. The legacy trigger (defined in
--     20260601_referral_commission_and_approval.sql) credits the
--     referrer's wallet on free->premium upgrades. From now on,
--     subscriptions referred by an ACTIVE ambassador are owned
--     exclusively by record_ambassador_commission() (30% first /
--     15% recurring on the real paid amount). Non-ambassador
--     referrals keep their original legacy behaviour unchanged.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_tier_upgrade_reward()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referrer_id UUID;
  reward_amount DECIMAL;
  referrer_wallet_id UUID;
  subscription_amount DECIMAL := 5000;
  direct_rate DECIMAL := 0.30;
BEGIN
  -- Only trigger on tier upgrade (not downgrade)
  IF OLD.user_tier = 'free' AND NEW.user_tier IN ('premium', 'exclusive') THEN
    -- Get referrer
    SELECT referred_by INTO referrer_id FROM profiles WHERE id = NEW.id;

    IF referrer_id IS NOT NULL THEN
      -- Skip legacy credit for active ambassadors: the FHA commission RPC
      -- now owns their subscription referral payout.
      IF EXISTS (SELECT 1 FROM ambassadors WHERE user_id = referrer_id AND is_active) THEN
        RETURN NEW;
      END IF;

      reward_amount := subscription_amount * direct_rate;

      -- Get referrer's wallet
      SELECT id INTO referrer_wallet_id FROM wallets WHERE user_id = referrer_id;

      IF referrer_wallet_id IS NOT NULL THEN
        -- Credit wallet
        UPDATE wallets
        SET user_wallet_balance = user_wallet_balance + reward_amount,
            updated_at = now()
        WHERE id = referrer_wallet_id;

        -- Create transaction
        INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
        VALUES (referrer_wallet_id, reward_amount, 'credit', 'Subscription referral reward', 'referral_system', 'completed');

        -- Update referral stats
        UPDATE referral_stats
        SET total_subscribed = total_subscribed + 1,
            total_earnings = total_earnings + reward_amount,
            updated_at = now()
        WHERE user_id = referrer_id;

        -- Notify referrer
        INSERT INTO notifications (user_id, title, message, type)
        VALUES (referrer_id, 'Subscription Referral Reward!', 'You earned ₦' || reward_amount::TEXT || ' from a subscription referral.', 'referral_reward');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;