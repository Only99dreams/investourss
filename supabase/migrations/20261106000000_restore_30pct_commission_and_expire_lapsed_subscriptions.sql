-- ============================================================
-- Restore 30% first-time commission + let lapsed subscriptions end
-- ============================================================
-- 1) FHA ambassador commission returns to:
--      * 30% first-time commission
--      * 20% recurring commission
--      * 10% indirect (level-2) bonus
--    Rates are applied to the VAT-exclusive actual price (amount / 1.075).
--
-- 2) Expired premium accounts now actually fall back to FREE instead of
--    quietly continuing to receive subscription credits. Two fixes:
--      * bookmaker_ensure_subscription_grant() no longer treats a stale
--        user_tier of 'premium' as an active subscription on its own.
--      * expire_lapsed_subscription() downgrades an account whose
--        subscription_expires_at is in the past.
--    A one-time backfill downgrades every already-lapsed account, and
--    expire_lapsed_subscriptions() is available for a scheduled job.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. FHA ambassador commission: 30% first-time / 20% recurring / 10% indirect
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_ambassador_commission(
  p_user_id UUID,
  p_amount NUMERIC,
  p_is_renewal BOOLEAN DEFAULT FALSE,
  p_source TEXT DEFAULT 'subscription'
)
RETURNS TABLE (
  out_commission_id UUID,
  out_amount NUMERIC,
  out_commission_type TEXT,
  out_ambassador_id UUID,
  out_referral_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;          -- the paying customer's direct referrer
  v_ambassador_id UUID;
  v_direct_wallet_id UUID;
  v_referral_id UUID;
  v_commission_id UUID;
  v_commission_type TEXT;
  v_rate NUMERIC;
  v_commission_amount NUMERIC;
  v_base NUMERIC;              -- VAT-exclusive actual price
  v_first_exists BOOLEAN;
  v_vat_rate NUMERIC := 0.075; -- 7.5% VAT
  v_direct_rate NUMERIC := 0.30;     -- 30% first-time
  v_recurring_rate NUMERIC := 0.20;  -- 20% recurring
  -- Indirect (level-2) bonus
  v_indirect_rate NUMERIC := 0.10;
  v_indirect_referrer_id UUID; -- the middle person (direct referrer's referrer chain)
  v_indirect_ambassador_id UUID;
  v_indirect_referral_id UUID;
  v_indirect_wallet_id UUID;
  v_indirect_amount NUMERIC;
BEGIN
  -- Commission base = actual price excluding VAT.
  v_base := COALESCE(p_amount, 0) / (1 + v_vat_rate);

  SELECT referred_by INTO v_referrer_id
  FROM profiles
  WHERE id = p_user_id;

  -- ============ DIRECT INCOME ============
  -- The direct referrer must be an active ambassador.
  SELECT id INTO v_ambassador_id
  FROM ambassadors
  WHERE user_id = v_referrer_id
    AND is_active = TRUE;

  IF v_ambassador_id IS NOT NULL THEN
    -- Ensure an (active) referral record exists
    INSERT INTO referrals (ambassador_id, referred_user_id, status, created_at)
    VALUES (v_ambassador_id, p_user_id, 'active', now())
    ON CONFLICT (ambassador_id, referred_user_id) DO UPDATE
      SET status = 'active';

    SELECT r.id INTO v_referral_id
    FROM referrals r
    WHERE r.ambassador_id = v_ambassador_id
      AND r.referred_user_id = p_user_id;

    -- A referral earns first_time (30%) exactly once; anything after is recurring (20%).
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

    v_commission_amount := v_base * v_rate;

    -- Only record an actual payout; a 0 amount must NOT burn the first-time slot.
    IF v_commission_amount > 0 THEN
      -- Record the commission
      INSERT INTO commissions (ambassador_id, referral_id, amount, commission_type, source)
      VALUES (v_ambassador_id, v_referral_id, v_commission_amount, v_commission_type, p_source)
      RETURNING id INTO v_commission_id;

      -- Mirror into the ambassador's running total
      UPDATE ambassadors
      SET total_earnings = total_earnings + v_commission_amount,
          updated_at = now()
      WHERE id = v_ambassador_id;

      -- Keep the Referrals dashboard "Total Earnings" in sync
      INSERT INTO referral_stats (user_id, total_earnings)
      VALUES (v_referrer_id, v_commission_amount)
      ON CONFLICT (user_id) DO UPDATE
        SET total_earnings = public.referral_stats.total_earnings + EXCLUDED.total_earnings,
            updated_at = now();

      -- Credit the ambassador's wallet (if one exists)
      SELECT id INTO v_direct_wallet_id
      FROM wallets
      WHERE user_id = v_referrer_id;

      IF v_direct_wallet_id IS NOT NULL THEN
        UPDATE wallets
        SET user_wallet_balance = user_wallet_balance + v_commission_amount,
            updated_at = now()
        WHERE id = v_direct_wallet_id;

        INSERT INTO wallet_transactions (
          wallet_id, amount, transaction_type, narration, source, status
        ) VALUES (
          v_direct_wallet_id,
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
          'You earned ₦' || v_commission_amount::TEXT || ' (' || v_commission_type || ') from a referred purchase.',
          'ambassador_commission'
        );
      END IF;
    END IF;
  END IF;

  -- ============ INDIRECT INCOME (10% level-2 bonus) ============
  -- Resolve the middle person's referrer; if THAT user is an active
  -- ambassador they earn 10% of this customer's payment.
  IF v_referrer_id IS NOT NULL THEN
    SELECT referred_by INTO v_indirect_referrer_id
    FROM profiles
    WHERE id = v_referrer_id;

    IF v_indirect_referrer_id IS NOT NULL
       AND v_indirect_referrer_id <> p_user_id THEN
      SELECT id INTO v_indirect_ambassador_id
      FROM ambassadors
      WHERE user_id = v_indirect_referrer_id
        AND is_active = TRUE;

      IF v_indirect_ambassador_id IS NOT NULL THEN
        v_indirect_amount := v_base * v_indirect_rate;

        IF v_indirect_amount > 0 THEN
          -- Link the bonus to the grandparent's referral of the middle person.
          INSERT INTO referrals (ambassador_id, referred_user_id, status, created_at)
          VALUES (v_indirect_ambassador_id, v_referrer_id, 'active', now())
          ON CONFLICT (ambassador_id, referred_user_id) DO UPDATE
            SET status = 'active';

          SELECT r.id INTO v_indirect_referral_id
          FROM referrals r
          WHERE r.ambassador_id = v_indirect_ambassador_id
            AND r.referred_user_id = v_referrer_id;

          INSERT INTO commissions (ambassador_id, referral_id, amount, commission_type, source)
          VALUES (v_indirect_ambassador_id, v_indirect_referral_id, v_indirect_amount, 'indirect', p_source);

          UPDATE ambassadors
          SET total_earnings = total_earnings + v_indirect_amount,
              updated_at = now()
          WHERE id = v_indirect_ambassador_id;

          -- Keep the indirect ambassador's Referrals "Total Earnings" in sync
          INSERT INTO referral_stats (user_id, total_earnings)
          VALUES (v_indirect_referrer_id, v_indirect_amount)
          ON CONFLICT (user_id) DO UPDATE
            SET total_earnings = public.referral_stats.total_earnings + EXCLUDED.total_earnings,
                updated_at = now();

          SELECT id INTO v_indirect_wallet_id
          FROM wallets
          WHERE user_id = v_indirect_referrer_id;

          IF v_indirect_wallet_id IS NOT NULL THEN
            UPDATE wallets
            SET user_wallet_balance = user_wallet_balance + v_indirect_amount,
                updated_at = now()
            WHERE id = v_indirect_wallet_id;

            INSERT INTO wallet_transactions (
              wallet_id, amount, transaction_type, narration, source, status
            ) VALUES (
              v_indirect_wallet_id,
              v_indirect_amount,
              'credit',
              'Ambassador indirect bonus (10%) on referral network purchase',
              'ambassador_commission',
              'completed'
            );

            INSERT INTO notifications (user_id, title, message, type)
            VALUES (
              v_indirect_referrer_id,
              'Ambassador Indirect Bonus Earned!',
              'You earned ₦' || v_indirect_amount::TEXT || ' (10% indirect bonus) from your referral network.',
              'ambassador_commission'
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_commission_id IS NULL THEN
    -- No direct commission (indirect may still have been paid out above).
    RETURN QUERY SELECT NULL::UUID, 0::NUMERIC, 'none'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT v_commission_id, v_commission_amount, v_commission_type, v_ambassador_id, v_referral_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN, TEXT) TO anon;

-- ------------------------------------------------------------------
-- 2. Bookmaker subscription grant: only pay while the plan is live
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bookmaker_ensure_subscription_grant(p_user_id UUID)
RETURNS public.bookmaker_subscription_credits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_active BOOLEAN;
  v_type TEXT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_granted INTEGER;
  v_grant public.bookmaker_subscription_credits;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A stale user_tier must not keep a lapsed plan alive. Access requires a
  -- live flag with no expiry, or an expiry that is still in the future.
  v_active :=
    (COALESCE(v_profile.has_active_subscription, FALSE)
      AND (v_profile.subscription_expires_at IS NULL OR v_profile.subscription_expires_at > now()))
    OR (v_profile.subscription_expires_at IS NOT NULL AND v_profile.subscription_expires_at > now());

  IF NOT v_active THEN
    RETURN NULL;
  END IF;

  v_type := COALESCE(v_profile.subscription_type, 'monthly');

  IF v_profile.subscription_expires_at IS NOT NULL AND v_profile.subscription_expires_at > now() THEN
    v_end := v_profile.subscription_expires_at;
    v_start := CASE v_type
      WHEN 'monthly' THEN v_end - INTERVAL '1 month'
      WHEN 'quarterly' THEN v_end - INTERVAL '3 months'
      WHEN 'biennial' THEN v_end - INTERVAL '6 months'
      WHEN 'annual' THEN v_end - INTERVAL '1 year'
      WHEN 'b2b_quarterly' THEN v_end - INTERVAL '3 months'
      WHEN 'b2b_annual' THEN v_end - INTERVAL '1 year'
      ELSE v_end - INTERVAL '1 month'
    END;
  ELSE
    -- Tier-based access without a stored expiry: use a rolling calendar month.
    v_start := date_trunc('month', now());
    v_end := date_trunc('month', now()) + INTERVAL '1 month';
    v_type := COALESCE(v_profile.subscription_type, 'monthly');
  END IF;

  v_granted := CASE v_type
    WHEN 'monthly' THEN 3
    WHEN 'quarterly' THEN 6
    WHEN 'biennial' THEN 9
    WHEN 'annual' THEN 15
    WHEN 'b2b_quarterly' THEN 6
    WHEN 'b2b_annual' THEN 15
    ELSE 3
  END;

  INSERT INTO public.bookmaker_subscription_credits
    (user_id, subscription_type, period_start, period_end, credits_granted)
  VALUES
    (p_user_id, v_type, v_start, v_end, v_granted)
  ON CONFLICT (user_id, period_start, period_end) DO UPDATE
    SET subscription_type = EXCLUDED.subscription_type,
        credits_granted = GREATEST(
          public.bookmaker_subscription_credits.credits_granted,
          EXCLUDED.credits_granted
        )
  RETURNING * INTO v_grant;

  RETURN v_grant;
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_ensure_subscription_grant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_ensure_subscription_grant(UUID) TO service_role;

-- ------------------------------------------------------------------
-- 3. Downgrade one lapsed account (called by the client after login)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_lapsed_subscription(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Signed-in members may only expire their own account; admins may expire any.
  IF auth.uid() IS NOT NULL
     AND auth.uid() <> v_uid
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  UPDATE public.profiles
  SET user_tier = 'free',
      has_active_subscription = FALSE,
      subscription_type = NULL,
      updated_at = now()
  WHERE id = v_uid
    AND subscription_expires_at IS NOT NULL
    AND subscription_expires_at <= now()
    AND (
      user_tier <> 'free'
      OR has_active_subscription = TRUE
      OR subscription_type IS NOT NULL
    );

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_lapsed_subscription(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_lapsed_subscription(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_lapsed_subscription(UUID) TO service_role;

-- ------------------------------------------------------------------
-- 4. One-time cleanup + reusable global sweep for a scheduled job
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_lapsed_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.profiles
  SET user_tier = 'free',
      has_active_subscription = FALSE,
      subscription_type = NULL,
      updated_at = now()
  WHERE subscription_expires_at IS NOT NULL
    AND subscription_expires_at <= now()
    AND (
      user_tier <> 'free'
      OR has_active_subscription = TRUE
      OR subscription_type IS NOT NULL
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_lapsed_subscriptions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_lapsed_subscriptions() TO service_role;

-- Downgrade every account that has already lapsed.
SELECT public.expire_lapsed_subscriptions();
