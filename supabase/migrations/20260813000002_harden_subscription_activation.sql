-- Harden Paystack subscription activation after charge.success.
--
-- Fixes "payment received, activation failed" for subscriptions. The client
-- (SubscriptionPayment.tsx) and webhook both call activate_paystack_subscription()
-- (added 20260809000000/0001). If those migrations were never applied to the live
-- database, the RPC does not exist and the client falls back to the generic
-- "payment received but activation failed" toast.
--
-- This migration is idempotent and safe to re-run, and is self-contained so it
-- works even if the Aug-09/10/11/12 migrations were partially applied:
--   * ensures the subscription_payments ledger table exists,
--   * creates the subscription_expiry_for_plan() helper,
--   * replaces activate_paystack_subscription() so that:
--       - the user's premium tier ALWAYS activates once a reference arrives,
--       - ambassador commission / status re-checks are best-effort and can never
--         block activation (errors are logged to commission_failures),
--       - re-processing a reference is a no-op (returns TRUE).

-- ============================================================
-- 1. Subscription payments ledger (idempotency by reference)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  plan_type TEXT NOT NULL,
  amount_kobo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  promo_code_id UUID REFERENCES public.promo_codes(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own subscription payments" ON public.subscription_payments;
CREATE POLICY "Users can view their own subscription payments"
  ON public.subscription_payments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own subscription payments" ON public.subscription_payments;
CREATE POLICY "Users can create their own subscription payments"
  ON public.subscription_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Allow the extended plan types (idempotent).
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_subscription_type_check
  CHECK (subscription_type IN ('monthly', 'quarterly', 'biennial', 'annual', 'b2b_annual'));

-- ============================================================
-- 2. Subscription expiry helper
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
-- 3. Hardened subscription activation RPC
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

  -- Idempotency: this reference was already processed -> nothing to do.
  IF EXISTS (SELECT 1 FROM subscription_payments WHERE reference = p_reference AND status = 'completed') THEN
    RETURN TRUE;
  END IF;

  v_amount_ngn := COALESCE(p_amount_kobo, 0) / 100.0;
  v_expires_at := public.subscription_expiry_for_plan(p_plan_type);

  SELECT id INTO v_admin_id FROM profiles
  WHERE role IN ('admin', 'super_admin')
  ORDER BY created_at ASC
  LIMIT 1;

  -- Record the payment (already exists -> keep going).
  INSERT INTO subscription_payments (user_id, reference, plan_type, amount_kobo, status, promo_code_id)
  VALUES (p_user_id, p_reference, p_plan_type, COALESCE(p_amount_kobo, 0), 'completed', p_promo_code_id)
  ON CONFLICT (reference) DO NOTHING;

  -- Record promo usage (if this payment used a promo code)
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

  -- Activate premium tier
  UPDATE profiles
  SET user_tier = 'premium',
      subscription_type = p_plan_type,
      has_active_subscription = TRUE,
      subscription_expires_at = v_expires_at,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- Wallet transaction for the subscription
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status, actor_id)
    SELECT w.id, v_amount_ngn, 'credit',
           'Paystack Premium Subscription - ' || p_plan_type || ' (Ref: ' || p_reference || ')',
           'subscription_payment', 'completed', v_admin_id
    FROM wallets w
    WHERE w.user_id = p_user_id;
  END IF;

  -- Notification
  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    p_user_id,
    '🎉 Premium Subscription Activated!',
    'Your premium subscription has been activated via Paystack. You now have access to all premium features.',
    'subscription_activated'
  );

  -- Ambassador commission (BEST-EFFORT: never blocks subscription activation).
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'record_ambassador_commission'
      AND n.nspname = 'public'
  ) THEN
    BEGIN
      PERFORM public.record_ambassador_commission(p_user_id, v_amount_ngn, FALSE);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.commission_failures (user_id, reference, amount, error_text)
      VALUES (p_user_id, p_reference, v_amount_ngn, LEFT(SQLERRM, 500));
      RAISE NOTICE 'Ambassador commission failed for %: %', p_reference, SQLERRM;
    END;
  END IF;

  -- Ambassador status re-check (BEST-EFFORT).
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'recheck_ambassador_status'
      AND n.nspname = 'public'
  ) THEN
    BEGIN
      PERFORM public.recheck_ambassador_status(p_user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Ambassador status re-check skipped for %: %', p_reference, SQLERRM;
    END;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_paystack_subscription(UUID, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_paystack_subscription(UUID, TEXT, TEXT, INTEGER, UUID) TO authenticated;
