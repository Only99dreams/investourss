-- Platform Credit promo codes can be scoped to one credit pack, the same way
-- subscription codes are scoped to a plan. A NULL credit_pack_id means the code
-- works on every active pack (the existing behaviour).
--
-- Idempotent and safe to re-run.

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS credit_pack_id UUID;

-- Deleting a pack must not silently turn a pack-only code into an all-packs
-- code, so the restriction stays in force (or blocks the delete).
ALTER TABLE public.promo_codes
  DROP CONSTRAINT IF EXISTS promo_codes_credit_pack_id_fkey;
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_credit_pack_id_fkey
  FOREIGN KEY (credit_pack_id) REFERENCES public.audit_credit_packs(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_promo_codes_credit_pack_id
  ON public.promo_codes (credit_pack_id);

COMMENT ON COLUMN public.promo_codes.credit_pack_id IS
  'When set, this promo code only discounts the selected platform credit pack. NULL means any pack.';

-- ============================================================
-- validate_credit_promo_code: accept the pack being purchased
-- ============================================================
DROP FUNCTION IF EXISTS public.validate_credit_promo_code(TEXT, UUID);
DROP FUNCTION IF EXISTS public.validate_credit_promo_code(TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION public.validate_credit_promo_code(
  p_code TEXT,
  p_user_id UUID,
  p_pack_id UUID DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  promo_record RECORD;
  v_pack_name TEXT;
BEGIN
  SELECT * INTO promo_record
  FROM promo_codes
  WHERE code = UPPER(p_code)
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
    AND applies_to IN ('credits', 'both')
    -- A NULL p_pack_id is used by the checkout when the shopper has not picked
    -- a pack yet; the purchase RPC still enforces the restriction.
    AND (p_pack_id IS NULL OR credit_pack_id IS NULL OR credit_pack_id = p_pack_id);

  IF NOT FOUND THEN
    RETURN json_build_object(
      'valid', false,
      'message', p_pack_id IS NULL
        ? 'Invalid or expired promo code for credit packs'
        : 'Invalid or expired promo code for this credit pack'
    );
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

  IF promo_record.credit_pack_id IS NOT NULL THEN
    SELECT name INTO v_pack_name FROM audit_credit_packs WHERE id = promo_record.credit_pack_id;
  END IF;

  RETURN json_build_object(
    'valid', true,
    'discount_percentage', promo_record.discount_percentage,
    'promo_code_id', promo_record.id,
    'credit_pack_id', promo_record.credit_pack_id,
    'credit_pack_name', v_pack_name,
    'message', 'Promo code applied successfully'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_credit_promo_code(TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_credit_promo_code(TEXT, UUID, UUID) TO authenticated;

-- ============================================================
-- purchase_audit_pack: re-check the pack restriction server-side
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
      AND applies_to IN ('credits', 'both')
      AND (credit_pack_id IS NULL OR credit_pack_id = p_pack_id);

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', FALSE, 'message', 'This promo code is not valid for this credit pack.');
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
