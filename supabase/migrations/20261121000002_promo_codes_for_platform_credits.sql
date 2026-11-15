-- Promo codes now work for platform (audit) credit packs as well as
-- subscriptions.
--
--   * promo_codes.applies_to            subscription | credits | both
--   * promo_codes.plan_type             gains 'all' so one code can cover every plan
--   * user_credit_packs                 records the promo, its discount and the
--                                       undiscounted price for reporting
--   * validate_promo_code               honours applies_to and plan_type 'all'
--   * validate_credit_promo_code        new validator for the credit checkout
--   * purchase_audit_pack               accepts a promo, discounts server-side,
--                                       and activates 100%-off packs immediately
--   * activate_audit_pack_payment       records the promo use exactly once
--   * activate_paystack_subscription    validates the promo before recording it
--   * activate_free_subscription        honours plan_type 'all' and applies_to
--
-- Idempotent and safe to re-run.

-- ============================================================
-- 1. Promo code scope
-- ============================================================
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'subscription';

ALTER TABLE public.promo_codes DROP CONSTRAINT IF EXISTS promo_codes_applies_to_check;
ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_applies_to_check
  CHECK (applies_to IN ('subscription', 'credits', 'both'));

ALTER TABLE public.promo_codes DROP CONSTRAINT IF EXISTS promo_codes_plan_type_check;
ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_plan_type_check
  CHECK (plan_type IN (
    'monthly', 'quarterly', 'biennial', 'annual',
    'b2b_quarterly', 'b2b_annual', 'all'
  ));

-- ============================================================
-- 2. Credit orders remember the discount that was quoted
-- ============================================================
ALTER TABLE public.user_credit_packs
  ADD COLUMN IF NOT EXISTS promo_code_id UUID REFERENCES public.promo_codes(id) ON DELETE SET NULL;
ALTER TABLE public.user_credit_packs
  ADD COLUMN IF NOT EXISTS discount_percentage NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE public.user_credit_packs
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC(15,2);
ALTER TABLE public.user_credit_packs
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

-- ============================================================
-- 3. Subscription promo validation understands scope and 'all'
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_promo_code(
  p_code TEXT,
  p_user_id UUID,
  p_plan_type TEXT DEFAULT 'annual'
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  promo_record RECORD;
BEGIN
  SELECT * INTO promo_record
  FROM promo_codes
  WHERE code = UPPER(p_code)
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
    AND applies_to IN ('subscription', 'both')
    AND (plan_type = p_plan_type OR plan_type = 'all');

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'message', 'Invalid or expired promo code');
  END IF;

  IF EXISTS (
    SELECT 1 FROM promo_code_uses
    WHERE promo_code_id = promo_record.id
      AND user_id = p_user_id
  ) THEN
    RETURN json_build_object('valid', false, 'message', 'Promo code already used by this account');
  END IF;

  IF promo_record.used_count >= promo_record.max_uses THEN
    RETURN json_build_object('valid', false, 'message', 'Promo code usage limit exceeded');
  END IF;

  RETURN json_build_object(
    'valid', true,
    'discount_percentage', promo_record.discount_percentage,
    'promo_code_id', promo_record.id,
    'applies_to', promo_record.applies_to,
    'message', 'Promo code applied successfully'
  );
END;
$$;

-- ============================================================
-- 4. New validator for the credit checkout
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_credit_promo_code(
  p_code TEXT,
  p_user_id UUID
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  promo_record RECORD;
BEGIN
  SELECT * INTO promo_record
  FROM promo_codes
  WHERE code = UPPER(p_code)
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
    AND applies_to IN ('credits', 'both');

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'message', 'Invalid or expired promo code for credit packs');
  END IF;

  IF EXISTS (
    SELECT 1 FROM promo_code_uses
    WHERE promo_code_id = promo_record.id
      AND user_id = p_user_id
  ) THEN
    RETURN json_build_object('valid', false, 'message', 'Promo code already used by this account');
  END IF;

  IF promo_record.used_count >= promo_record.max_uses THEN
    RETURN json_build_object('valid', false, 'message', 'Promo code usage limit exceeded');
  END IF;

  RETURN json_build_object(
    'valid', true,
    'discount_percentage', promo_record.discount_percentage,
    'promo_code_id', promo_record.id,
    'message', 'Promo code applied successfully'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_credit_promo_code(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_credit_promo_code(TEXT, UUID) TO authenticated;

-- ============================================================
-- 5. purchase_audit_pack: apply the promo server-side
-- ============================================================
DROP FUNCTION IF EXISTS public.purchase_audit_pack(UUID);
DROP FUNCTION IF EXISTS public.purchase_audit_pack(UUID, UUID);

CREATE OR REPLACE FUNCTION public.purchase_audit_pack(
  p_pack_id UUID,
  p_promo_code_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_pack RECORD;
  v_promo RECORD;
  v_ref TEXT;
  v_order_id UUID;
  v_discount NUMERIC := 0;
  v_discount_amount NUMERIC := 0;
  v_amount NUMERIC;
  v_expiry TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Not authenticated.');
  END IF;

  SELECT name, credits, price, validity_days INTO v_pack
  FROM audit_credit_packs
  WHERE id = p_pack_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Audit credit pack not found or inactive.');
  END IF;

  IF p_promo_code_id IS NOT NULL THEN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE id = p_promo_code_id
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
      AND applies_to IN ('credits', 'both');

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', FALSE, 'message', 'This promo code is not valid for credit packs.');
    END IF;

    IF v_promo.used_count >= v_promo.max_uses THEN
      RETURN jsonb_build_object('success', FALSE, 'message', 'This promo code has reached its usage limit.');
    END IF;

    IF EXISTS (
      SELECT 1 FROM promo_code_uses
      WHERE promo_code_id = p_promo_code_id AND user_id = v_user_id
    ) THEN
      RETURN jsonb_build_object('success', FALSE, 'message', 'This promo code has already been used on this account.');
    END IF;

    v_discount := v_promo.discount_percentage;
  END IF;

  v_discount_amount := ROUND(v_pack.price * v_discount / 100.0, 2);
  v_amount := GREATEST(v_pack.price - v_discount_amount, 0);

  v_ref := 'AC-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 10));

  INSERT INTO user_credit_packs (
    user_id, pack_id, pack_name, credits, amount,
    original_amount, discount_amount, discount_percentage, promo_code_id,
    reference, status
  )
  VALUES (
    v_user_id, p_pack_id, v_pack.name, v_pack.credits, v_amount,
    v_pack.price, v_discount_amount, v_discount, p_promo_code_id,
    v_ref, 'pending'
  )
  RETURNING id INTO v_order_id;

  -- A 100%-off code needs no Paystack charge: grant the pack immediately and
  -- record the promo use here, since no payment activation will run.
  IF v_amount <= 0 THEN
    v_expiry := now() + (COALESCE(v_pack.validity_days, 30) || ' days')::INTERVAL;

    UPDATE user_credit_packs
    SET status = 'active',
        credits_remaining = v_pack.credits,
        expires_at = v_expiry,
        activated_at = now()
    WHERE id = v_order_id;

    UPDATE profiles
    SET audit_credits = COALESCE(audit_credits, 0) + v_pack.credits,
        updated_at = now()
    WHERE id = v_user_id;

    IF p_promo_code_id IS NOT NULL THEN
      INSERT INTO promo_code_uses (promo_code_id, user_id, discount_applied, plan_type)
      VALUES (p_promo_code_id, v_user_id, v_discount_amount, 'credits');

      UPDATE promo_codes
      SET used_count = used_count + 1
      WHERE id = p_promo_code_id;
    END IF;

    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      v_user_id,
      'Platform Credits Added!',
      'Your ' || v_pack.name || ' (' || v_pack.credits || ' credits) has been activated with a 100% promo code.',
      'audit_credits_added'
    );

    RETURN jsonb_build_object(
      'success', TRUE,
      'free', TRUE,
      'order_id', v_order_id,
      'reference', v_ref,
      'pack_name', v_pack.name,
      'amount', 0,
      'original_amount', v_pack.price,
      'discount_amount', v_discount_amount,
      'discount_percentage', v_discount,
      'credits', v_pack.credits,
      'validity_days', v_pack.validity_days
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'free', FALSE,
    'order_id', v_order_id,
    'reference', v_ref,
    'pack_name', v_pack.name,
    'amount', v_amount,
    'original_amount', v_pack.price,
    'discount_amount', v_discount_amount,
    'discount_percentage', v_discount,
    'credits', v_pack.credits,
    'validity_days', v_pack.validity_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_audit_pack(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_audit_pack(UUID, UUID) TO authenticated;

-- ============================================================
-- 6. activate_audit_pack_payment: record promo use once
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_audit_pack_payment(
  p_user_id UUID,
  p_reference TEXT,
  p_amount_kobo INTEGER DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_validity INTEGER;
  v_expiry TIMESTAMPTZ;
  v_admin_id UUID;
  v_amount_ngn NUMERIC;
BEGIN
  IF p_user_id IS NULL OR p_reference IS NULL OR p_reference = '' THEN
    RAISE EXCEPTION 'user_id and reference are required';
  END IF;

  -- Idempotency: this reference was already processed -> nothing to do.
  IF EXISTS (SELECT 1 FROM user_credit_packs WHERE reference = p_reference AND status = 'active') THEN
    RETURN TRUE;
  END IF;

  SELECT * INTO v_order
  FROM user_credit_packs
  WHERE reference = p_reference AND user_id = p_user_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending audit pack order not found for reference %', p_reference;
  END IF;

  v_amount_ngn := COALESCE(p_amount_kobo, 0) / 100.0;

  SELECT id INTO v_admin_id FROM profiles
  WHERE role IN ('admin', 'super_admin')
  ORDER BY created_at ASC
  LIMIT 1;

  -- Record the payment
  INSERT INTO audit_pack_payments (user_id, reference, amount_kobo, status)
  VALUES (p_user_id, p_reference, COALESCE(p_amount_kobo, 0), 'completed')
  ON CONFLICT (reference) DO NOTHING;

  SELECT validity_days INTO v_validity
  FROM audit_credit_packs WHERE id = v_order.pack_id;
  v_validity := COALESCE(v_validity, 30);

  v_expiry := now() + (v_validity || ' days')::INTERVAL;

  -- Activate the order
  UPDATE user_credit_packs
  SET status = 'active',
      credits_remaining = v_order.credits,
      expires_at = v_expiry,
      activated_at = now(),
      activated_by = v_admin_id
  WHERE id = v_order.id;

  -- Credit the user's audit credits
  UPDATE profiles
  SET audit_credits = COALESCE(audit_credits, 0) + v_order.credits,
      updated_at = now()
  WHERE id = p_user_id;

  -- Record the promo use exactly once per account.
  IF v_order.promo_code_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM promo_code_uses
    WHERE promo_code_id = v_order.promo_code_id AND user_id = p_user_id
  ) THEN
    INSERT INTO promo_code_uses (promo_code_id, user_id, discount_applied, plan_type)
    VALUES (
      v_order.promo_code_id,
      p_user_id,
      COALESCE(v_order.discount_amount, 0),
      'credits'
    );

    UPDATE promo_codes
    SET used_count = used_count + 1
    WHERE id = v_order.promo_code_id;
  END IF;

  -- Wallet transaction for the pack
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status, actor_id)
    SELECT w.id, v_amount_ngn, 'credit',
           'Paystack Audit Credit Pack - ' || v_order.pack_name || ' (Ref: ' || p_reference || ')',
           'audit_pack_payment', 'completed', v_admin_id
    FROM wallets w
    WHERE w.user_id = p_user_id;
  END IF;

  -- Notification
  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    p_user_id,
    'Audit Credits Added!',
    'Your ' || v_order.pack_name || ' (' || v_order.credits || ' audit credits) has been activated via Paystack.',
    'audit_credits_added'
  );

  -- Ambassador commission (function is idempotent per referral: first_time 30%
  -- exactly once, any later pack/subscription routes to recurring 15%).
  PERFORM public.record_ambassador_commission(p_user_id, v_amount_ngn, FALSE);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_audit_pack_payment(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_audit_pack_payment(UUID, TEXT, INTEGER) TO authenticated;

-- ============================================================
-- 7. Admin manual activation records promo use too
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_user_audit_pack(p_order_id UUID, p_admin_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_validity INTEGER;
  v_expiry TIMESTAMPTZ;
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  SELECT * INTO v_order FROM user_credit_packs WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status = 'active' THEN
    RETURN TRUE;
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Order is not pending';
  END IF;

  SELECT validity_days INTO v_validity
  FROM audit_credit_packs WHERE id = v_order.pack_id;
  v_validity := COALESCE(v_validity, 30);

  v_expiry := now() + (v_validity || ' days')::INTERVAL;

  UPDATE user_credit_packs
  SET status = 'active',
      credits_remaining = v_order.credits,
      expires_at = v_expiry,
      activated_at = now(),
      activated_by = p_admin_id
  WHERE id = p_order_id;

  UPDATE profiles
  SET audit_credits = COALESCE(audit_credits, 0) + v_order.credits,
      updated_at = now()
  WHERE id = v_order.user_id;

  IF v_order.promo_code_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM promo_code_uses
    WHERE promo_code_id = v_order.promo_code_id AND user_id = v_order.user_id
  ) THEN
    INSERT INTO promo_code_uses (promo_code_id, user_id, discount_applied, plan_type)
    VALUES (
      v_order.promo_code_id,
      v_order.user_id,
      COALESCE(v_order.discount_amount, 0),
      'credits'
    );

    UPDATE promo_codes
    SET used_count = used_count + 1
    WHERE id = v_order.promo_code_id;
  END IF;

  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    v_order.user_id,
    'Audit Credits Added!',
    'Your ' || v_order.pack_name || ' (' || v_order.credits || ' audit credits) has been activated.',
    'audit_credits_added'
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_user_audit_pack(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_user_audit_pack(UUID, UUID) TO authenticated;

-- ============================================================
-- 8. activate_paystack_subscription: validate the promo server-side
-- ============================================================
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
  v_promo RECORD;
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

  -- The discount was quoted to the browser, so record the use only if the code
  -- is still usable for this plan and this account. A stale code must never
  -- block a payment the member has already made, so drop it instead of raising.
  IF p_promo_code_id IS NOT NULL THEN
    SELECT * INTO v_promo
    FROM promo_codes
    WHERE id = p_promo_code_id
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
      AND applies_to IN ('subscription', 'both')
      AND (plan_type = p_plan_type OR plan_type = 'all');

    IF NOT FOUND
      OR v_promo.used_count >= v_promo.max_uses
      OR EXISTS (
        SELECT 1 FROM promo_code_uses
        WHERE promo_code_id = p_promo_code_id AND user_id = p_user_id
      )
    THEN
      RAISE NOTICE 'Promo code % was not recorded for reference %', p_promo_code_id, p_reference;
      p_promo_code_id := NULL;
    END IF;
  END IF;

  -- Record the payment (already exists -> keep going).
  INSERT INTO subscription_payments (user_id, reference, plan_type, amount_kobo, status, promo_code_id)
  VALUES (p_user_id, p_reference, p_plan_type, COALESCE(p_amount_kobo, 0), 'completed', p_promo_code_id)
  ON CONFLICT (reference) DO NOTHING;

  -- Record promo usage (if this payment used a promo code)
  IF p_promo_code_id IS NOT NULL THEN
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

-- ============================================================
-- 9. activate_free_subscription: allow plan_type 'all' and scope
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_free_subscription(
  p_user_id UUID,
  p_plan_type TEXT,
  p_promo_code_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo RECORD;
  v_admin_id UUID;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorised to activate this subscription'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_promo
  FROM public.promo_codes
  WHERE id = p_promo_code_id
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > now())
    AND discount_percentage = 100
    AND applies_to IN ('subscription', 'both')
    AND (plan_type = p_plan_type OR plan_type = 'all');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This promo code is not valid for a free subscription.';
  END IF;

  IF v_promo.used_count >= v_promo.max_uses THEN
    RAISE EXCEPTION 'This promo code has reached its usage limit.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.promo_code_uses
    WHERE promo_code_id = p_promo_code_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'This promo code has already been used on this account.';
  END IF;

  SELECT id INTO v_admin_id FROM public.profiles
  WHERE role IN ('admin', 'super_admin')
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO public.promo_code_uses (promo_code_id, user_id, discount_applied, plan_type)
  VALUES (p_promo_code_id, p_user_id, 0, p_plan_type);

  UPDATE public.promo_codes
  SET used_count = used_count + 1
  WHERE id = p_promo_code_id;

  UPDATE public.profiles
  SET user_tier = 'premium',
      subscription_type = p_plan_type,
      has_active_subscription = TRUE,
      subscription_expires_at = public.subscription_expiry_for_plan(p_plan_type),
      updated_at = NOW()
  WHERE id = p_user_id;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.wallet_transactions (wallet_id, amount, transaction_type, narration, source, status, actor_id)
    SELECT w.id, 0, 'credit',
           CONCAT('Free Premium Subscription - ', p_plan_type, ' (100% discount)'),
           'subscription_payment', 'completed', v_admin_id
    FROM public.wallets w WHERE w.user_id = p_user_id;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    p_user_id,
    '🎉 Premium Subscription Activated!',
    CONCAT('Your premium subscription has been activated for free! You now have access to all premium features for the ', p_plan_type, ' plan.'),
    'subscription_activated'
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_free_subscription(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_free_subscription(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_free_subscription(UUID, TEXT, UUID) TO service_role;
