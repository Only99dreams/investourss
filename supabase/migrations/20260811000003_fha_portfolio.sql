-- FHA Portfolio
-- 1. Audit credit pack purchases now earn ambassador commissions (30% first /
--    15% recurring), mirroring subscription payouts so the FHA Portfolio's
--    "Amount Earned" figures on pack cards reflect real earnings.
-- 2. get_fha_portfolio() RPC returns the ambassador's portfolio breakdown of
--    active referred users (audit credit packs 30/90/360 days and subscribers
--    monthly/quarterly/biennial/annual, split individual vs business) with the
--    commission earned from each bucket. Used to determine Quarterly Reward
--    qualification.

-- ============================================================
-- 1. Pack purchases earn ambassador commissions
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
-- 2. get_fha_portfolio(): portfolio breakdown for the current ambassador
-- ============================================================
-- An "active" subscriber has an active, non-expired subscription. An "active"
-- audit credit pack user has at least one active, non-expired pack; users may
-- appear in more than one validity bucket if they hold packs of different
-- durations (counts), but each referred user's commission is attributed to a
-- SINGLE bucket (their subscription if active, otherwise their longest pack) so
-- the earned totals never double-count a user.
CREATE OR REPLACE FUNCTION public.get_fha_portfolio()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH my AS (
    SELECT id AS ambassador_id
    FROM public.ambassadors
    WHERE user_id = auth.uid()
  ),
  refs AS (
    SELECT r.id AS referral_id,
           r.referred_user_id AS uid,
           p.account_type,
           p.has_active_subscription,
           p.subscription_type,
           p.subscription_expires_at,
           COALESCE((SELECT SUM(c.amount) FROM public.commissions c WHERE c.referral_id = r.id), 0) AS commission
    FROM public.referrals r
    JOIN public.profiles p ON p.id = r.referred_user_id
    WHERE r.ambassador_id = (SELECT ambassador_id FROM my)
      AND r.status = 'active'
  ),
  subs AS (
    SELECT uid,
           account_type,
           CASE WHEN subscription_type = 'b2b_annual' THEN 'annual' ELSE subscription_type END AS plan,
           commission
    FROM refs
    WHERE has_active_subscription = TRUE
      AND (subscription_expires_at IS NULL OR subscription_expires_at > now())
  ),
  packs AS (
    SELECT r.uid,
           r.account_type,
           r.commission,
           CASE
             WHEN pck.validity_days <= 30 THEN '30'
             WHEN pck.validity_days <= 90 THEN '90'
             ELSE '360'
           END AS bucket,
           ROW_NUMBER() OVER (PARTITION BY r.uid ORDER BY pck.validity_days DESC) AS rn
    FROM refs r
    JOIN public.user_credit_packs ucp ON ucp.user_id = r.uid
    JOIN public.audit_credit_packs pck ON pck.id = ucp.pack_id
    WHERE ucp.status = 'active'
      AND (ucp.expires_at IS NULL OR ucp.expires_at > now())
  ),
  pack_counts AS (
    SELECT account_type, bucket, COUNT(DISTINCT uid) AS users
    FROM packs
    GROUP BY account_type, bucket
  ),
  pack_commissions AS (
    SELECT account_type, bucket, COALESCE(SUM(commission), 0) AS commission
    FROM packs
    WHERE rn = 1
      AND uid NOT IN (SELECT uid FROM subs)
    GROUP BY account_type, bucket
  ),
  sub_counts AS (
    SELECT account_type, plan, COUNT(DISTINCT uid) AS users, COALESCE(SUM(commission), 0) AS commission
    FROM subs
    GROUP BY account_type, plan
  )
  SELECT jsonb_build_object(
    'has_ambassador', TRUE,
    'packs', jsonb_build_object(
      'individuals', jsonb_build_object(
        'buckets', jsonb_build_object(
          '30', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'individual' AND bucket = '30'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'individual' AND bucket = '30'), 0)),
          '90', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'individual' AND bucket = '90'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'individual' AND bucket = '90'), 0)),
          '360', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'individual' AND bucket = '360'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'individual' AND bucket = '360'), 0))
        ),
        'total_users', COALESCE((SELECT COUNT(DISTINCT uid) FROM packs WHERE account_type = 'individual'), 0),
        'total_commission', COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'individual'), 0)
      ),
      'businesses', jsonb_build_object(
        'buckets', jsonb_build_object(
          '30', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'business' AND bucket = '30'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'business' AND bucket = '30'), 0)),
          '90', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'business' AND bucket = '90'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'business' AND bucket = '90'), 0)),
          '360', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'business' AND bucket = '360'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'business' AND bucket = '360'), 0))
        ),
        'total_users', COALESCE((SELECT COUNT(DISTINCT uid) FROM packs WHERE account_type = 'business'), 0),
        'total_commission', COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'business'), 0)
      )
    ),
    'subscribers', jsonb_build_object(
      'individuals', jsonb_build_object(
        'buckets', jsonb_build_object(
          'monthly', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'individual' AND plan = 'monthly'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'individual' AND plan = 'monthly'), 0)),
          'quarterly', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'individual' AND plan = 'quarterly'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'individual' AND plan = 'quarterly'), 0)),
          'biennial', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'individual' AND plan = 'biennial'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'individual' AND plan = 'biennial'), 0)),
          'annual', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'individual' AND plan = 'annual'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'individual' AND plan = 'annual'), 0))
        ),
        'total_users', COALESCE((SELECT SUM(users) FROM sub_counts WHERE account_type = 'individual'), 0),
        'total_commission', COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'individual'), 0)
      ),
      'businesses', jsonb_build_object(
        'buckets', jsonb_build_object(
          'monthly', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'business' AND plan = 'monthly'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'business' AND plan = 'monthly'), 0)),
          'quarterly', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'business' AND plan = 'quarterly'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'business' AND plan = 'quarterly'), 0)),
          'biennial', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'business' AND plan = 'biennial'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'business' AND plan = 'biennial'), 0)),
          'annual', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'business' AND plan = 'annual'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'business' AND plan = 'annual'), 0))
        ),
        'total_users', COALESCE((SELECT SUM(users) FROM sub_counts WHERE account_type = 'business'), 0),
        'total_commission', COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'business'), 0)
      )
    ),
    'total_earned_individuals',
      COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'individual'), 0)
      + COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'individual'), 0),
    'total_earned_businesses',
      COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'business'), 0)
      + COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'business'), 0),
    'current_portfolio_value',
      COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'individual'), 0)
      + COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'individual'), 0)
      + COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'business'), 0)
      + COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'business'), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.get_fha_portfolio() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fha_portfolio() TO authenticated;
