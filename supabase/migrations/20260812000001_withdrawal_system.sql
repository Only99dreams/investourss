-- Wallet withdrawal system (user request + admin approval)
--
-- * request_withdrawal() : SECURITY DEFINER — validates the request server-side,
--   computes the processing fee (10% paying users / 15% free users) on the full
--   requested amount, holds the gross amount by debiting the wallet, records the
--   pending debit transaction and creates the pending withdrawal request.
-- * process_withdrawal_request() : SECURITY DEFINER — admin approves (completes
--   the held debit) or rejects (refunds the gross amount + cancels the debit).
--
-- The fee rates are enforced server-side so they cannot be bypassed from the client.
--   Paying user   = has_active_subscription OR user_tier IN ('premium','exclusive')
--   Free user     = everything else

-- ============================================================
-- 1. Extra columns on withdrawal_requests
--    amount = NET payout (what the user receives), matching legacy inserts.
--    gross_amount = full requested amount deducted from the wallet.
-- ============================================================
ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS gross_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_transaction_id UUID REFERENCES public.wallet_transactions(id) ON DELETE SET NULL;

-- ============================================================
-- 2. RPC: request a withdrawal
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount NUMERIC,
  p_wallet_type TEXT DEFAULT 'user_wallet'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_profile RECORD;
  v_wallet RECORD;
  v_fee_rate NUMERIC;
  v_fee NUMERIC;
  v_net NUMERIC;
  v_txn_id UUID;
  v_req_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Not authenticated.');
  END IF;

  IF p_wallet_type NOT IN ('user_wallet', 'gfe_wallet') THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Invalid wallet type.');
  END IF;

  IF p_amount IS NULL OR p_amount < 5000 THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Minimum withdrawal is ₦5,000.');
  END IF;

  SELECT id, user_tier, has_active_subscription INTO v_profile
  FROM profiles
  WHERE id = v_user_id;

  IF COALESCE(v_profile.has_active_subscription, FALSE)
     OR v_profile.user_tier IN ('premium', 'exclusive') THEN
    v_fee_rate := 0.10;  -- Paying users
  ELSE
    v_fee_rate := 0.15;  -- Free users
  END IF;

  SELECT * INTO v_wallet
  FROM wallets
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Wallet not found.');
  END IF;

  IF COALESCE(v_wallet.bank_account_number, '') = '' THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Add your bank details before requesting a withdrawal.');
  END IF;

  v_fee := ROUND(p_amount * v_fee_rate, 2);
  v_net := p_amount - v_fee;

  IF p_wallet_type = 'gfe_wallet' THEN
    IF COALESCE(v_wallet.gfe_wallet_balance, 0) < p_amount THEN
      RETURN jsonb_build_object('success', FALSE, 'message', 'Insufficient funds in GFE Wallet.');
    END IF;
  ELSE
    IF COALESCE(v_wallet.user_wallet_balance, 0) < p_amount THEN
      RETURN jsonb_build_object('success', FALSE, 'message', 'Insufficient funds in User Wallet.');
    END IF;
  END IF;

  -- Hold the full requested amount (gross) by deducting it from the wallet.
  IF p_wallet_type = 'gfe_wallet' THEN
    UPDATE wallets
    SET gfe_wallet_balance = gfe_wallet_balance - p_amount,
        updated_at = now()
    WHERE id = v_wallet.id;
  ELSE
    UPDATE wallets
    SET user_wallet_balance = user_wallet_balance - p_amount,
        updated_at = now()
    WHERE id = v_wallet.id;
  END IF;

  -- Pending debit transaction (completed on approval, cancelled + refunded on rejection).
  INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
  VALUES (v_wallet.id, p_amount, 'debit', 'Withdrawal request (pending approval)', 'withdrawal', 'pending')
  RETURNING id INTO v_txn_id;

  INSERT INTO withdrawal_requests (
    user_id, amount, gross_amount, fee_amount, fee_rate, wallet_type, status, wallet_transaction_id
  )
  VALUES (v_user_id, v_net, p_amount, v_fee, v_fee_rate, p_wallet_type, 'pending', v_txn_id)
  RETURNING id INTO v_req_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'request_id', v_req_id,
    'gross_amount', p_amount,
    'fee_rate', v_fee_rate,
    'fee_amount', v_fee,
    'net_amount', v_net
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_withdrawal(NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(NUMERIC, TEXT) TO authenticated;

-- ============================================================
-- 3. RPC: admin approves / rejects a withdrawal request
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_withdrawal_request(
  p_request_id UUID,
  p_admin_id UUID,
  p_action TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req RECORD;
  v_admin_name TEXT;
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  SELECT * INTO v_req
  FROM withdrawal_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request not found';
  END IF;

  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Withdrawal request already processed';
  END IF;

  SELECT full_name INTO v_admin_name FROM profiles WHERE id = p_admin_id;

  IF p_action = 'approve' THEN
    UPDATE withdrawal_requests
    SET status = 'approved',
        processed_by = p_admin_id,
        processed_at = now(),
        notes = CONCAT('Approved by ', COALESCE(v_admin_name, 'Admin'))
    WHERE id = p_request_id;

    -- The gross amount was already held; completing the debit finalises the payout.
    IF v_req.wallet_transaction_id IS NOT NULL THEN
      UPDATE wallet_transactions
      SET status = 'completed'
      WHERE id = v_req.wallet_transaction_id;
    END IF;

    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      v_req.user_id,
      '✅ Withdrawal Approved',
      'Your withdrawal of ₦' || v_req.amount::TEXT || ' has been approved and is being processed to your bank account.',
      'withdrawal_approved'
    );

  ELSIF p_action = 'reject' THEN
    UPDATE withdrawal_requests
    SET status = 'rejected',
        processed_by = p_admin_id,
        processed_at = now(),
        notes = CONCAT('Rejected by ', COALESCE(v_admin_name, 'Admin'))
    WHERE id = p_request_id;

    -- Return the full held amount.
    IF v_req.wallet_type = 'gfe_wallet' THEN
      UPDATE wallets
      SET gfe_wallet_balance = gfe_wallet_balance + v_req.gross_amount,
          updated_at = now()
      WHERE user_id = v_req.user_id;
    ELSE
      UPDATE wallets
      SET user_wallet_balance = user_wallet_balance + v_req.gross_amount,
          updated_at = now()
      WHERE user_id = v_req.user_id;
    END IF;

    IF v_req.wallet_transaction_id IS NOT NULL THEN
      UPDATE wallet_transactions
      SET status = 'cancelled'
      WHERE id = v_req.wallet_transaction_id;
    END IF;

    INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
    SELECT w.id, v_req.gross_amount, 'credit', 'Withdrawal rejected - funds returned', 'withdrawal_refund', 'completed'
    FROM wallets w
    WHERE w.user_id = v_req.user_id;

    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      v_req.user_id,
      'Withdrawal Rejected',
      'Your withdrawal request of ₦' || v_req.gross_amount::TEXT || ' was rejected. The amount has been returned to your wallet.',
      'withdrawal_rejected'
    );
  ELSE
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.process_withdrawal_request(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_withdrawal_request(UUID, UUID, TEXT) TO authenticated;
