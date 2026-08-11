-- Paystack subscription activation
-- Records the Paystack transaction, activates the user's premium tier and
-- wires up promo usage + ambassador commission, mirroring the manual deposit
-- and free-subscription activation flows.

-- Allow the extended plan types now that Paystack powers monthly/quarterly/
-- biennial/annual/b2b_annual subscriptions.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_subscription_type_check
  CHECK (subscription_type IN ('monthly', 'quarterly', 'biennial', 'annual', 'b2b_annual'));

-- Relax the promo code plan check to cover the new plan types too.
ALTER TABLE public.promo_codes DROP CONSTRAINT IF EXISTS promo_codes_plan_type_check;
ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_plan_type_check
  CHECK (plan_type IN ('monthly', 'quarterly', 'biennial', 'annual', 'b2b_annual'));

-- ============================================================
-- Subscription payments ledger (idempotency by reference)
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

-- ============================================================
-- RPC: activate a subscription after a successful Paystack charge
-- ============================================================
-- Drop any earlier version of this function first: CREATE OR REPLACE cannot
-- change the return type of an existing function with the same signature.
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
BEGIN
  IF p_user_id IS NULL OR p_reference IS NULL OR p_plan_type IS NULL THEN
    RAISE EXCEPTION 'user_id, reference and plan_type are required';
  END IF;

  -- Idempotency: this reference was already processed -> nothing to do.
  IF EXISTS (SELECT 1 FROM subscription_payments WHERE reference = p_reference AND status = 'completed') THEN
    RETURN TRUE;
  END IF;

  v_amount_ngn := COALESCE(p_amount_kobo, 0) / 100.0;

  SELECT id INTO v_admin_id FROM profiles
  WHERE role IN ('admin', 'super_admin')
  ORDER BY created_at ASC
  LIMIT 1;

  -- Record the payment
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

  -- First-time subscription -> 30% ambassador commission (function is idempotent).
  PERFORM public.record_ambassador_commission(p_user_id, v_amount_ngn, FALSE);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_paystack_subscription(UUID, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_paystack_subscription(UUID, TEXT, TEXT, INTEGER, UUID) TO authenticated;
