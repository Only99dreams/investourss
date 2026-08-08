-- Fix SQLSTATE 42702 "column reference is ambiguous" (column vs PL/pgSQL OUT variable).
-- Functions declared with RETURNS TABLE create OUT parameters; any bare column name
-- inside the function body that matches an OUT parameter becomes ambiguous and the
-- call fails (e.g. get_audit_access -> 'column reference "credits_remaining" is ambiguous').
-- Fix: qualify every such column reference with a table alias.

-- 1) get_audit_access
CREATE OR REPLACE FUNCTION public.get_audit_access(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  can_audit BOOLEAN,
  access_type TEXT,
  free_audit_used BOOLEAN,
  subscription_active BOOLEAN,
  credits_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_sub BOOLEAN;
  v_free_used BOOLEAN;
  v_credits INTEGER;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'none', FALSE, FALSE, 0;
    RETURN;
  END IF;

  SELECT COALESCE(has_active_subscription, FALSE) INTO v_sub
  FROM profiles WHERE id = v_user_id;

  SELECT EXISTS (
    SELECT 1 FROM financial_audits WHERE user_id = v_user_id AND is_free = TRUE
  ) INTO v_free_used;

  SELECT COALESCE(SUM(ucp.credits_remaining), 0)::INTEGER INTO v_credits
  FROM user_credit_packs ucp
  WHERE ucp.user_id = v_user_id
    AND ucp.status = 'active'
    AND (ucp.expires_at IS NULL OR ucp.expires_at > now());

  RETURN QUERY
    SELECT (v_sub OR NOT v_free_used OR v_credits > 0) AS can_audit,
           CASE
             WHEN v_sub THEN 'subscription'
             WHEN NOT v_free_used THEN 'free'
             WHEN v_credits > 0 THEN 'credits'
             ELSE 'none'
           END AS access_type,
           v_free_used AS free_audit_used,
           v_sub AS subscription_active,
           v_credits AS credits_remaining;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audit_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_access(UUID) TO authenticated;

-- 2) apply_ambassador
CREATE OR REPLACE FUNCTION public.apply_ambassador(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (success BOOLEAN, referral_code TEXT, tier TEXT, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral_code TEXT;
  v_tier TEXT;
  v_profile_code TEXT;
BEGIN
  -- Resolve the calling user when not explicitly passed
  IF p_user_id IS NULL THEN
    p_user_id := auth.uid();
  END IF;

  -- Membership guard: active subscription OR audit credits
  IF NOT public.check_ambassador_eligibility(p_user_id) THEN
    RETURN QUERY
      SELECT FALSE, NULL::TEXT, NULL::TEXT,
             'Ineligible: an active subscription or audit credits are required to become an ambassador.'::TEXT;
    RETURN;
  END IF;

  -- Already registered?
  SELECT a.referral_code, a.tier, a.is_active
  INTO v_referral_code, v_tier
  FROM ambassadors a
  WHERE a.user_id = p_user_id;

  IF v_referral_code IS NOT NULL THEN
    -- Reactivate if previously deactivated
    IF NOT EXISTS (SELECT 1 FROM ambassadors WHERE user_id = p_user_id AND is_active) THEN
      UPDATE ambassadors
      SET is_active = TRUE,
          updated_at = now()
      WHERE user_id = p_user_id;
      v_tier := COALESCE(v_tier, 'Star');
    END IF;

    RETURN QUERY
      SELECT TRUE, v_referral_code, COALESCE(v_tier, 'Star')::TEXT,
             'You are already registered as an ambassador.'::TEXT;
    RETURN;
  END IF;

  -- Reuse the user's existing referral code; generate one if missing (defensive)
  SELECT p.referral_code INTO v_profile_code
  FROM profiles p
  WHERE p.id = p_user_id;

  IF v_profile_code IS NULL THEN
    v_profile_code := 'INV' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    UPDATE profiles
    SET referral_code = v_profile_code
    WHERE id = p_user_id;
  END IF;

  INSERT INTO ambassadors (user_id, referral_code, tier, total_earnings, is_active)
  VALUES (p_user_id, v_profile_code, 'Star', 0, TRUE);

  RETURN QUERY
    SELECT TRUE, v_profile_code, 'Star'::TEXT,
           'Ambassador registration successful. Welcome aboard!'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ambassador(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ambassador(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ambassador(UUID) TO anon;

-- 3) record_ambassador_commission
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
