-- Backfill ambassador commissions for audit credit pack purchases that were
-- activated BEFORE the commission call was introduced.
--
-- Timeline: activate_audit_pack_payment() (20260810000001) never called
-- record_ambassador_commission(); the portfolio migration (20260811000003)
-- added the call but called it directly, so the 42702 output-param bug (fixed
-- in 20260813000003) would have rolled the whole activation back; the hardened
-- version (20260813000000) added best-effort commission + commission_failures
-- logging. Pack purchases activated before any of these were live therefore
-- recorded NO commission AND no failure row -> there was nothing for
-- 20260813000003's replay to pick up.
--
-- This migration is idempotent and safe to re-run:
--   * adds audit_pack_payments.commission_recorded_at so each completed pack
--     payment is commissioned exactly once,
--   * rewrites activate_audit_pack_payment() to mark that column after a
--     successful best-effort commission (keeps future purchases + re-runs
--     consistent),
--   * backfills every completed, not-yet-commissioned audit_pack_payments row
--     through record_ambassador_commission() (first_time 30% for the referral's
--     first payout, recurring 15% afterwards; 2% indirect handled internally),
--   * re-syncs referral_stats.total_earnings from the commissions ledger.

-- ============================================================
-- 1. Track whether a pack payment already earned its commission
-- ============================================================
ALTER TABLE public.audit_pack_payments
  ADD COLUMN IF NOT EXISTS commission_recorded_at TIMESTAMPTZ;

-- ============================================================
-- 2. Hardened activation RPC (marks commission_recorded_at on success)
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
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'record_ambassador_commission'
      AND n.nspname = 'public'
  ) THEN
    BEGIN
      PERFORM public.record_ambassador_commission(p_user_id, v_amount_ngn, FALSE);
      -- Mark this payment as commissioned so a backfill/re-run never double-pays.
      UPDATE public.audit_pack_payments
      SET commission_recorded_at = now()
      WHERE reference = p_reference;
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

-- ============================================================
-- 3. Backfill completed pack payments that never earned a commission
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, user_id, reference, amount_kobo
    FROM public.audit_pack_payments
    WHERE status = 'completed'
      AND commission_recorded_at IS NULL
    ORDER BY created_at ASC
  LOOP
    BEGIN
      PERFORM public.record_ambassador_commission(r.user_id, r.amount_kobo::NUMERIC / 100.0, FALSE);
      UPDATE public.audit_pack_payments
      SET commission_recorded_at = now()
      WHERE id = r.id;
      RAISE NOTICE 'Backfilled audit pack commission for %', r.reference;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.commission_failures (user_id, reference, amount, error_text)
      VALUES (r.user_id, r.reference, r.amount_kobo::NUMERIC / 100.0, LEFT(SQLERRM, 500));
      RAISE NOTICE 'Audit pack commission backfill failed for %: %', r.reference, SQLERRM;
    END;
  END LOOP;
END $$;

-- ============================================================
-- 4. Re-sync referral_stats.total_earnings from the commissions
--    ledger (matches 20260813000001/0003)
-- ============================================================
UPDATE public.referral_stats rs
SET total_earnings = COALESCE((
      SELECT SUM(c.amount)
      FROM public.commissions c
      JOIN public.ambassadors a ON a.id = c.ambassador_id
      WHERE a.user_id = rs.user_id
    ), 0),
    updated_at = now()
WHERE rs.user_id IN (SELECT a.user_id FROM public.ambassadors a);
