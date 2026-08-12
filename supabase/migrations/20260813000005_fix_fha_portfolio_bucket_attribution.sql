-- Fix: FHA portfolio attributes a referred user's ENTIRE commission to a single
-- bucket, and subscribers take precedence (pack_commissions excludes
-- `uid NOT IN (SELECT uid FROM subs)`). When a referred user is BOTH an active
-- subscriber AND an audit credit pack buyer, the pack purchase commission was
-- lumped into "Active Subscribers" instead of "Active Audit Credit Pack Users".
--
-- This migration is idempotent and safe to re-run:
--   * adds commissions.source ('subscription' | 'audit_pack') so each payout can
--     be attributed to the purchase that earned it,
--   * rewrites record_ambassador_commission() to accept p_source (default
--     'subscription') and store it on every direct/indirect commission row,
--   * rewrites activate_audit_pack_payment() to pass 'audit_pack',
--   * backfills existing commissions: rows matching a subscription payment are
--     tagged 'subscription'; everything else 'audit_pack',
--   * rewrites get_fha_portfolio() to sum subscription vs audit-pack commissions
--     separately, so a subscriber-with-pack appears in BOTH cards with the
--     correct per-purchase commission.

-- ============================================================
-- 1. commissions.source column
-- ============================================================
ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_source_check;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_source_check
  CHECK (source IN ('subscription', 'audit_pack'));

-- ============================================================
-- 2. record_ambassador_commission with p_source
-- ============================================================
DROP FUNCTION IF EXISTS public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN);

CREATE OR REPLACE FUNCTION public.record_ambassador_commission(
  p_user_id UUID,
  p_amount NUMERIC,
  p_is_renewal BOOLEAN DEFAULT FALSE,
  p_source TEXT DEFAULT 'subscription'
)
RETURNS TABLE (
  out_commission_id UUID,
  out_amount NUMERIC,
  out_commission_type TEXT,
  out_ambassador_id UUID,
  out_referral_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;          -- the paying customer's direct referrer
  v_ambassador_id UUID;
  v_direct_wallet_id UUID;
  v_referral_id UUID;
  v_commission_id UUID;
  v_commission_type TEXT;
  v_rate NUMERIC;
  v_commission_amount NUMERIC;
  v_base NUMERIC;              -- VAT-exclusive actual price
  v_first_exists BOOLEAN;
  v_vat_rate NUMERIC := 0.075; -- 7.5% VAT
  v_direct_rate NUMERIC := 0.30;     -- 30% first-time
  v_recurring_rate NUMERIC := 0.15;  -- 15% recurring
  -- Indirect (level-2) bonus
  v_indirect_rate NUMERIC := 0.02;
  v_indirect_referrer_id UUID; -- the middle person (direct referrer's referrer chain)
  v_indirect_ambassador_id UUID;
  v_indirect_referral_id UUID;
  v_indirect_wallet_id UUID;
  v_indirect_amount NUMERIC;
BEGIN
  -- Commission base = actual price excluding VAT.
  v_base := COALESCE(p_amount, 0) / (1 + v_vat_rate);

  SELECT referred_by INTO v_referrer_id
  FROM profiles
  WHERE id = p_user_id;

  -- ============ DIRECT INCOME ============
  -- The direct referrer must be an active ambassador.
  SELECT id INTO v_ambassador_id
  FROM ambassadors
  WHERE user_id = v_referrer_id
    AND is_active = TRUE;

  IF v_ambassador_id IS NOT NULL THEN
    -- Ensure an (active) referral record exists
    INSERT INTO referrals (ambassador_id, referred_user_id, status, created_at)
    VALUES (v_ambassador_id, p_user_id, 'active', now())
    ON CONFLICT (ambassador_id, referred_user_id) DO UPDATE
      SET status = 'active';

    SELECT r.id INTO v_referral_id
    FROM referrals r
    WHERE r.ambassador_id = v_ambassador_id
      AND r.referred_user_id = p_user_id;

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

    v_commission_amount := v_base * v_rate;

    -- Only record an actual payout; a 0 amount must NOT burn the first-time slot.
    IF v_commission_amount > 0 THEN
      -- Record the commission
      INSERT INTO commissions (ambassador_id, referral_id, amount, commission_type, source)
      VALUES (v_ambassador_id, v_referral_id, v_commission_amount, v_commission_type, p_source)
      RETURNING id INTO v_commission_id;

      -- Mirror into the ambassador's running total
      UPDATE ambassadors
      SET total_earnings = total_earnings + v_commission_amount,
          updated_at = now()
      WHERE id = v_ambassador_id;

      -- Keep the Referrals dashboard "Total Earnings" in sync
      INSERT INTO referral_stats (user_id, total_earnings)
      VALUES (v_referrer_id, v_commission_amount)
      ON CONFLICT (user_id) DO UPDATE
        SET total_earnings = public.referral_stats.total_earnings + EXCLUDED.total_earnings,
            updated_at = now();

      -- Credit the ambassador's wallet (if one exists)
      SELECT id INTO v_direct_wallet_id
      FROM wallets
      WHERE user_id = v_referrer_id;

      IF v_direct_wallet_id IS NOT NULL THEN
        UPDATE wallets
        SET user_wallet_balance = user_wallet_balance + v_commission_amount,
            updated_at = now()
        WHERE id = v_direct_wallet_id;

        INSERT INTO wallet_transactions (
          wallet_id, amount, transaction_type, narration, source, status
        ) VALUES (
          v_direct_wallet_id,
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
          'You earned ₦' || v_commission_amount::TEXT || ' (' || v_commission_type || ') from a referred purchase.',
          'ambassador_commission'
        );
      END IF;
    END IF;
  END IF;

  -- ============ INDIRECT INCOME (2% level-2 bonus) ============
  -- Resolve the middle person's referrer; if THAT user is an active
  -- ambassador they earn 2% of this customer's payment.
  IF v_referrer_id IS NOT NULL THEN
    SELECT referred_by INTO v_indirect_referrer_id
    FROM profiles
    WHERE id = v_referrer_id;

    IF v_indirect_referrer_id IS NOT NULL
       AND v_indirect_referrer_id <> p_user_id THEN
      SELECT id INTO v_indirect_ambassador_id
      FROM ambassadors
      WHERE user_id = v_indirect_referrer_id
        AND is_active = TRUE;

      IF v_indirect_ambassador_id IS NOT NULL THEN
        v_indirect_amount := v_base * v_indirect_rate;

        IF v_indirect_amount > 0 THEN
          -- Link the bonus to the grandparent's referral of the middle person.
          INSERT INTO referrals (ambassador_id, referred_user_id, status, created_at)
          VALUES (v_indirect_ambassador_id, v_referrer_id, 'active', now())
          ON CONFLICT (ambassador_id, referred_user_id) DO UPDATE
            SET status = 'active';

          SELECT r.id INTO v_indirect_referral_id
          FROM referrals r
          WHERE r.ambassador_id = v_indirect_ambassador_id
            AND r.referred_user_id = v_referrer_id;

          INSERT INTO commissions (ambassador_id, referral_id, amount, commission_type, source)
          VALUES (v_indirect_ambassador_id, v_indirect_referral_id, v_indirect_amount, 'indirect', p_source);

          UPDATE ambassadors
          SET total_earnings = total_earnings + v_indirect_amount,
              updated_at = now()
          WHERE id = v_indirect_ambassador_id;

          -- Keep the indirect ambassador's Referrals "Total Earnings" in sync
          INSERT INTO referral_stats (user_id, total_earnings)
          VALUES (v_indirect_referrer_id, v_indirect_amount)
          ON CONFLICT (user_id) DO UPDATE
            SET total_earnings = public.referral_stats.total_earnings + EXCLUDED.total_earnings,
                updated_at = now();

          SELECT id INTO v_indirect_wallet_id
          FROM wallets
          WHERE user_id = v_indirect_referrer_id;

          IF v_indirect_wallet_id IS NOT NULL THEN
            UPDATE wallets
            SET user_wallet_balance = user_wallet_balance + v_indirect_amount,
                updated_at = now()
            WHERE id = v_indirect_wallet_id;

            INSERT INTO wallet_transactions (
              wallet_id, amount, transaction_type, narration, source, status
            ) VALUES (
              v_indirect_wallet_id,
              v_indirect_amount,
              'credit',
              'Ambassador indirect bonus (2%) on referral network purchase',
              'ambassador_commission',
              'completed'
            );

            INSERT INTO notifications (user_id, title, message, type)
            VALUES (
              v_indirect_referrer_id,
              'Ambassador Indirect Bonus Earned!',
              'You earned ₦' || v_indirect_amount::TEXT || ' (2% indirect bonus) from your referral network.',
              'ambassador_commission'
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_commission_id IS NULL THEN
    -- No direct commission (indirect may still have been paid out above).
    RETURN QUERY SELECT NULL::UUID, 0::NUMERIC, 'none'::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT v_commission_id, v_commission_amount, v_commission_type, v_ambassador_id, v_referral_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN, TEXT) TO anon;

-- ============================================================
-- 3. activate_audit_pack_payment passes 'audit_pack'
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
      PERFORM public.record_ambassador_commission(p_user_id, v_amount_ngn, FALSE, 'audit_pack');
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
-- 4. Backfill source for existing commissions (idempotent)
-- ============================================================
-- A commission whose (VAT-exclusive base x rate) matches a completed
-- subscription payment is a subscription payout; anything else is a pack payout.
UPDATE public.commissions c
SET source = 'subscription'
FROM public.referrals r
JOIN public.subscription_payments sp ON sp.user_id = r.referred_user_id
WHERE c.referral_id = r.id
  AND c.source IS NULL
  AND c.amount = ROUND(
        (sp.amount_kobo::NUMERIC / 100.0 / 1.075) *
        CASE WHEN c.commission_type = 'first_time' THEN 0.30 ELSE 0.15 END,
        2
      );

UPDATE public.commissions
SET source = 'audit_pack'
WHERE source IS NULL;

-- ============================================================
-- 5. get_fha_portfolio: split subscription vs audit-pack commissions
-- ============================================================
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
           COALESCE((SELECT SUM(c.amount) FROM public.commissions c WHERE c.referral_id = r.id AND c.source = 'subscription'), 0) AS sub_commission,
           COALESCE((SELECT SUM(c.amount) FROM public.commissions c WHERE c.referral_id = r.id AND c.source = 'audit_pack'), 0) AS pack_commission
    FROM public.referrals r
    JOIN public.profiles p ON p.id = r.referred_user_id
    WHERE r.ambassador_id = (SELECT ambassador_id FROM my)
      AND r.status = 'active'
  ),
  subs AS (
    SELECT uid,
           account_type,
           CASE WHEN subscription_type = 'b2b_annual' THEN 'annual' ELSE subscription_type END AS plan,
           sub_commission AS commission
    FROM refs
    WHERE has_active_subscription = TRUE
      AND (subscription_expires_at IS NULL OR subscription_expires_at > now())
  ),
  packs AS (
    SELECT r.uid,
           r.account_type,
           r.pack_commission,
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
    SELECT account_type, bucket, COALESCE(SUM(pack_commission), 0) AS commission
    FROM packs
    WHERE rn = 1
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
