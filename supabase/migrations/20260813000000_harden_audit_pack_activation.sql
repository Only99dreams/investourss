-- Harden audit credit pack activation after Paystack charge.success.
--
-- Fixes the "payment received but activation failed" case where the
-- activate_audit_pack_payment() RPC (added 20260810000001) was never applied to
-- the live database, or a side-effect (ambassador commission) raised and rolled
-- back the whole transaction.
--
-- This migration is idempotent and safe to run even if the earlier Aug-10/11/12
-- migrations were partially applied:
--   * ensures the audit_pack_payments ledger table exists,
--   * allows the 'indirect' commission type (20260812000000),
--   * replaces activate_audit_pack_payment() so that:
--       - credits ALWAYS activate once a pending order exists,
--       - the ambassador commission is best-effort (never blocks activation),
--       - re-processing a reference is a no-op (returns TRUE).

-- ============================================================
-- 1. Audit pack payments ledger (idempotent by reference)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_pack_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  amount_kobo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.audit_pack_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own audit pack payments" ON public.audit_pack_payments;
CREATE POLICY "Users can view own audit pack payments"
  ON public.audit_pack_payments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own audit pack payments" ON public.audit_pack_payments;
CREATE POLICY "Users can create own audit pack payments"
  ON public.audit_pack_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 2. Allow the 'indirect' commission type
-- ============================================================
ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_commission_type_check;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_commission_type_check
  CHECK (commission_type IN ('first_time', 'recurring', 'indirect'));

-- ============================================================
-- 2b. Commission failure log (so activation never silently drops a payout)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.commission_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  reference TEXT,
  amount NUMERIC,
  error_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.commission_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view commission failures" ON public.commission_failures;
CREATE POLICY "Admins view commission failures"
  ON public.commission_failures FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 3. Hardened activation RPC
-- ============================================================
DROP FUNCTION IF EXISTS public.activate_audit_pack_payment(UUID, TEXT, INTEGER);

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

  -- Record the payment (already exists -> keep going, order may be pending
  -- from a prior interrupted activation).
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

  -- Ambassador commission (BEST-EFFORT: never blocks credit activation).
  -- record_ambassador_commission() may not exist if the Aug-04+ ambassador
  -- migrations were not applied, and it may raise (e.g. 'indirect' check
  -- constraint on a partially applied Aug-12 migration). None of that should
  -- prevent the customer's paid credits from activating.
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

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_audit_pack_payment(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_audit_pack_payment(UUID, TEXT, INTEGER) TO authenticated;
