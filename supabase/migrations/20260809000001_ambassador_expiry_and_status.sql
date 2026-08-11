-- Ambassador active-membership enforcement
-- - profiles: add subscription_expires_at + audit_credits_expires_at
-- - check_ambassador_eligibility: require non-expired access
-- - activate_paystack_subscription: set subscription_expires_at by plan
-- - activate_free_subscription: set subscription_expires_at by plan
-- - recheck_ambassador_status: auto-deactivate/reactivate based on eligibility
-- - get_ambassador_leaderboard: filter to is_active ambassadors only

-- ============================================================
-- 1. Expiry columns on profiles
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audit_credits_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_subscription_expires_at
  ON public.profiles (subscription_expires_at);
CREATE INDEX IF NOT EXISTS idx_profiles_audit_credits_expires_at
  ON public.profiles (audit_credits_expires_at);

-- ============================================================
-- 2. Updated eligibility guard: active subscription OR non-expired
--    audit credits. An ambassador who lapses is no longer eligible.
-- ============================================================
DROP FUNCTION IF EXISTS public.check_ambassador_eligibility(UUID);

CREATE OR REPLACE FUNCTION public.check_ambassador_eligibility(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_sub BOOLEAN;
  v_sub_expires TIMESTAMPTZ;
  v_credits INTEGER;
  v_credit_expires TIMESTAMPTZ;
BEGIN
  SELECT
    has_active_subscription,
    subscription_expires_at,
    audit_credits,
    audit_credits_expires_at
  INTO
    v_has_sub,
    v_sub_expires,
    v_credits,
    v_credit_expires
  FROM profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF COALESCE(v_has_sub, FALSE)
     AND v_sub_expires IS NOT NULL
     AND v_sub_expires > now() THEN
    RETURN TRUE;
  END IF;

  IF COALESCE(v_credits, 0) > 0
     AND v_credit_expires IS NOT NULL
     AND v_credit_expires > now() THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.check_ambassador_eligibility(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_ambassador_eligibility(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_ambassador_eligibility(UUID) TO anon;

-- ============================================================
-- 3. Helper: compute subscription expiry by plan type
-- ============================================================
CREATE OR REPLACE FUNCTION public.subscription_expiry_for_plan(p_plan_type TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_plan_type
    WHEN 'monthly'    THEN now() + INTERVAL '30 days'
    WHEN 'quarterly'  THEN now() + INTERVAL '90 days'
    WHEN 'biennial'   THEN now() + INTERVAL '180 days'
    WHEN 'annual'     THEN now() + INTERVAL '365 days'
    WHEN 'b2b_annual' THEN now() + INTERVAL '365 days'
    ELSE now() + INTERVAL '30 days'
  END;
$$;

REVOKE ALL ON FUNCTION public.subscription_expiry_for_plan(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_expiry_for_plan(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_expiry_for_plan(TEXT) TO anon;

-- ============================================================
-- 4. Re-create activate_paystack_subscription with expiry
-- ============================================================
DROP FUNCTION IF EXISTS public.activate_paystack_subscription(UUID, TEXT, TEXT, INTEGER, UUID);

CREATE OR REPLACE FUNCTION public.activate_paystack_subscription(
  p_user_id UUID,
  p_reference TEXT,
  p_plan_type TEXT,
  p_amount_kobo INTEGER DEFAULT 0,
  p_promo_code_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_amount_ngn NUMERIC;
  v_expires_at TIMESTAMPTZ;
BEGIN
  IF p_user_id IS NULL OR p_reference IS NULL OR p_plan_type IS NULL THEN
    RAISE EXCEPTION 'user_id, reference and plan_type are required';
  END IF;

  IF EXISTS (SELECT 1 FROM subscription_payments WHERE reference = p_reference AND status = 'completed') THEN
    RETURN TRUE;
  END IF;

  v_amount_ngn := COALESCE(p_amount_kobo, 0) / 100.0;
  v_expires_at := public.subscription_expiry_for_plan(p_plan_type);

  SELECT id INTO v_admin_id FROM profiles
  WHERE role IN ('admin', 'super_admin')
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO subscription_payments (user_id, reference, plan_type, amount_kobo, status, promo_code_id)
  VALUES (p_user_id, p_reference, p_plan_type, COALESCE(p_amount_kobo, 0), 'completed', p_promo_code_id)
  ON CONFLICT (reference) DO NOTHING;

  IF p_promo_code_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM promo_code_uses
    WHERE promo_code_id = p_promo_code_id AND user_id = p_user_id
  ) THEN
    INSERT INTO promo_code_uses (promo_code_id, user_id, discount_applied, plan_type)
    VALUES (p_promo_code_id, p_user_id, v_amount_ngn, p_plan_type);

    UPDATE promo_codes
    SET used_count = used_count + 1
    WHERE id = p_promo_code_id;
  END IF;

  UPDATE profiles
  SET user_tier = 'premium',
      subscription_type = p_plan_type,
      has_active_subscription = TRUE,
      subscription_expires_at = v_expires_at,
      updated_at = NOW()
  WHERE id = p_user_id;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status, actor_id)
    SELECT w.id, v_amount_ngn, 'credit',
           'Paystack Premium Subscription - ' || p_plan_type || ' (Ref: ' || p_reference || ')',
           'subscription_payment', 'completed', v_admin_id
    FROM wallets w
    WHERE w.user_id = p_user_id;
  END IF;

  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    p_user_id,
    '🎉 Premium Subscription Activated!',
    'Your premium subscription has been activated via Paystack. You now have access to all premium features.',
    'subscription_activated'
  );

  PERFORM public.record_ambassador_commission(p_user_id, v_amount_ngn, FALSE);
  PERFORM public.recheck_ambassador_status(p_user_id);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_paystack_subscription(UUID, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_paystack_subscription(UUID, TEXT, TEXT, INTEGER, UUID) TO authenticated;

-- ============================================================
-- 5. Re-create activate_free_subscription with expiry
-- ============================================================
DROP FUNCTION IF EXISTS public.activate_free_subscription(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.activate_free_subscription(
  p_user_id UUID,
  p_plan_type TEXT,
  p_promo_code_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_user RECORD;
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT id INTO admin_user FROM profiles WHERE role IN ('admin', 'super_admin') LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No admin user found for transaction processing';
  END IF;

  INSERT INTO promo_code_uses (promo_code_id, user_id, discount_applied, plan_type)
  VALUES (p_promo_code_id, p_user_id, 0, p_plan_type);

  UPDATE promo_codes
  SET used_count = used_count + 1
  WHERE id = p_promo_code_id;

  v_expires_at := public.subscription_expiry_for_plan(p_plan_type);

  UPDATE profiles
  SET user_tier = 'premium',
      subscription_type = p_plan_type,
      has_active_subscription = TRUE,
      subscription_expires_at = v_expires_at,
      updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions (
    wallet_id, amount, transaction_type, narration, source, status, actor_id
  )
  SELECT w.id, 0, 'credit',
         CONCAT('Free Premium Subscription - ', p_plan_type, ' (100% discount)'),
         'subscription_payment', 'completed', admin_user.id
  FROM wallets w WHERE w.user_id = p_user_id;

  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    p_user_id,
    '🎉 Premium Subscription Activated!',
    CONCAT('Your premium subscription has been activated for free! You now have access to all premium features for the ', p_plan_type, ' plan.'),
    'subscription_activated'
  );

  PERFORM public.recheck_ambassador_status(p_user_id);

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. Auto-toggle ambassador active status based on eligibility
-- ============================================================
-- Called by:
--   - activate_paystack_subscription (after payment / renewal)
--   - activate_free_subscription (after 100% promo activation)
--   - Frontend dashboard on mount (re-sync after expiry)
--   - Optional cron / webhook on subscription.churned events
-- ============================================================
CREATE OR REPLACE FUNCTION public.recheck_ambassador_status(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eligible BOOLEAN;
  v_is_active BOOLEAN;
BEGIN
  v_eligible := public.check_ambassador_eligibility(p_user_id);

  SELECT is_active INTO v_is_active
  FROM public.ambassadors
  WHERE user_id = p_user_id;

  IF v_is_active IS NULL THEN
    RETURN;
  END IF;

  IF v_eligible AND NOT v_is_active THEN
    UPDATE public.ambassadors
    SET is_active = TRUE, updated_at = now()
    WHERE user_id = p_user_id;
  ELSIF NOT v_eligible AND v_is_active THEN
    UPDATE public.ambassadors
    SET is_active = FALSE, updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.recheck_ambassador_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recheck_ambassador_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recheck_ambassador_status(UUID) TO anon;

-- ============================================================
-- 7. Leaderboard should only surface active ambassadors
-- ============================================================
DROP FUNCTION IF EXISTS public.get_ambassador_leaderboard();

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
  WHERE is_active = TRUE
  ORDER BY monthly_commission DESC, total_earnings DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.get_ambassador_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_ambassador_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ambassador_leaderboard() TO anon;
