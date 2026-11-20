-- ============================================================
-- Final commission design + single B2B plan
-- ============================================================
-- 1) Subscription commissions
--      General referrers: 30% first-time / 10% recurring / 10% indirect
--      Active B2B referrers: 30% first-time / 30% recurring / 10% indirect
--    The higher recurring rate is earned by the REFERRER while their own B2B
--    subscription is live. Platform credit packs keep their existing
--    30% first / 20% recurring / 10% indirect behaviour.
--
-- 2) B2B plan refresh
--      ₦1,440,000 / 12 months / unlimited ebooks
--    Both legacy plan codes (b2b_quarterly, b2b_annual) remain valid in the
--    database for existing rows, but both now describe the same single offer.
--    A NULL ebook item limit disables the Bookmaker quota check, which is how
--    "unlimited ebooks" is expressed.
--
-- Rates continue to apply to the VAT-exclusive price (amount / 1.075).
-- ============================================================

-- ------------------------------------------------------------------
-- 1. FHA ambassador commission: final tiered rates
-- ------------------------------------------------------------------
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
  v_referrer_profile RECORD;
  v_referrer_active_b2b BOOLEAN := FALSE;
  v_source TEXT := lower(COALESCE(p_source, 'subscription'));
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
  v_recurring_rate NUMERIC;          -- resolved from source + referrer tier
  v_indirect_rate NUMERIC := 0.10;   -- 10% indirect (level-2) bonus
  v_indirect_referrer_id UUID;
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

  -- Recurring rate for subscriptions depends on the REFERRER's live plan.
  -- Non-subscription sources (platform credit packs) keep the legacy 20%.
  IF v_source = 'subscription' THEN
    SELECT subscription_type, has_active_subscription, subscription_expires_at
    INTO v_referrer_profile
    FROM profiles
    WHERE id = v_referrer_id;

    v_referrer_active_b2b :=
      lower(COALESCE(v_referrer_profile.subscription_type, '')) IN ('b2b_quarterly', 'b2b_annual')
      AND (
        (COALESCE(v_referrer_profile.has_active_subscription, FALSE)
          AND (v_referrer_profile.subscription_expires_at IS NULL
               OR v_referrer_profile.subscription_expires_at > now()))
        OR (v_referrer_profile.subscription_expires_at IS NOT NULL
            AND v_referrer_profile.subscription_expires_at > now())
      );

    v_recurring_rate := CASE WHEN v_referrer_active_b2b THEN 0.30 ELSE 0.10 END;
  ELSE
    v_recurring_rate := 0.20;
  END IF;

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

    -- A referral earns first_time (30%) exactly once; anything after is recurring.
    SELECT EXISTS (
      SELECT 1 FROM commissions c
      WHERE c.referral_id = v_referral_id
        AND c.commission_type = 'first_time'
    ) INTO v_first_exists;

    IF v_first_exists OR COALESCE(p_is_renewal, FALSE) THEN
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

  -- ============ INDIRECT INCOME (10% level-2 bonus) ============
  -- Resolve the middle person's referrer; if THAT user is an active
  -- ambassador they earn 10% of this customer's payment.
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
              'Ambassador indirect bonus (10%) on referral network purchase',
              'ambassador_commission',
              'completed'
            );

            INSERT INTO notifications (user_id, title, message, type)
            VALUES (
              v_indirect_referrer_id,
              'Ambassador Indirect Bonus Earned!',
              'You earned ₦' || v_indirect_amount::TEXT || ' (10% indirect bonus) from your referral network.',
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

-- ------------------------------------------------------------------
-- 2. Credit pack activation: mark the source so it keeps 20% recurring
-- ------------------------------------------------------------------
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
    v_order.user_id,
    'Audit Credits Added!',
    'Your ' || v_order.pack_name || ' (' || v_order.credits || ' audit credits) has been activated via Paystack.',
    'audit_credits_added'
  );

  -- Credit packs keep the existing 30% first / 20% recurring behaviour.
  PERFORM public.record_ambassador_commission(p_user_id, v_amount_ngn, FALSE, 'audit_pack');

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_audit_pack_payment(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_audit_pack_payment(UUID, TEXT, INTEGER) TO authenticated;

-- ------------------------------------------------------------------
-- 3. B2B plan: ₦1,440,000 / 12 months / unlimited ebooks
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_price_for_plan(p_plan_type TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(COALESCE(p_plan_type, ''))
    WHEN 'monthly'       THEN 38250
    WHEN 'quarterly'     THEN 102000
    WHEN 'biennial'      THEN 191250
    WHEN 'annual'        THEN 382500
    WHEN 'b2b_quarterly' THEN 1440000
    WHEN 'b2b_annual'    THEN 1440000
    ELSE 38250
  END::NUMERIC;
$$;

REVOKE ALL ON FUNCTION public.subscription_price_for_plan(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_price_for_plan(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_price_for_plan(TEXT) TO anon;

CREATE OR REPLACE FUNCTION public.subscription_expiry_for_plan(p_plan_type TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(COALESCE(p_plan_type, ''))
    WHEN 'monthly'       THEN now() + INTERVAL '30 days'
    WHEN 'quarterly'     THEN now() + INTERVAL '90 days'
    WHEN 'biennial'      THEN now() + INTERVAL '180 days'
    WHEN 'annual'        THEN now() + INTERVAL '365 days'
    WHEN 'b2b_quarterly' THEN now() + INTERVAL '365 days'
    WHEN 'b2b_annual'    THEN now() + INTERVAL '365 days'
    ELSE now() + INTERVAL '30 days'
  END;
$$;

REVOKE ALL ON FUNCTION public.subscription_expiry_for_plan(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_expiry_for_plan(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_expiry_for_plan(TEXT) TO anon;

-- NULL disables the Bookmaker ebook-quota check, i.e. unlimited ebooks.
CREATE OR REPLACE FUNCTION public.bookmaker_plan_item_limit(p_type TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_type, ''))
    WHEN 'monthly' THEN 4
    WHEN 'quarterly' THEN 8
    WHEN 'biennial' THEN 16
    WHEN 'biannual' THEN 16
    WHEN 'bi-annual' THEN 16
    WHEN 'annual' THEN 32
    WHEN 'b2b_quarterly' THEN NULL
    WHEN 'b2b_annual' THEN NULL
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_plan_item_limit(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_plan_item_limit(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookmaker_plan_item_limit(TEXT) TO service_role;

-- B2B grants now cover a full 12-month period. Included operations are already
-- zero-cost for subscribers, so the credit count is only an audit figure.
CREATE OR REPLACE FUNCTION public.bookmaker_ensure_subscription_grant(p_user_id UUID)
RETURNS public.bookmaker_subscription_credits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_active BOOLEAN;
  v_type TEXT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_granted INTEGER;
  v_grant public.bookmaker_subscription_credits;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A stale user_tier must not keep a lapsed plan alive. Access requires a
  -- live flag with no expiry, or an expiry that is still in the future.
  v_active :=
    (COALESCE(v_profile.has_active_subscription, FALSE)
      AND (v_profile.subscription_expires_at IS NULL OR v_profile.subscription_expires_at > now()))
    OR (v_profile.subscription_expires_at IS NOT NULL AND v_profile.subscription_expires_at > now());

  IF NOT v_active THEN
    RETURN NULL;
  END IF;

  v_type := COALESCE(v_profile.subscription_type, 'monthly');

  IF v_profile.subscription_expires_at IS NOT NULL AND v_profile.subscription_expires_at > now() THEN
    v_end := v_profile.subscription_expires_at;
    v_start := CASE v_type
      WHEN 'monthly' THEN v_end - INTERVAL '1 month'
      WHEN 'quarterly' THEN v_end - INTERVAL '3 months'
      WHEN 'biennial' THEN v_end - INTERVAL '6 months'
      WHEN 'annual' THEN v_end - INTERVAL '1 year'
      WHEN 'b2b_quarterly' THEN v_end - INTERVAL '1 year'
      WHEN 'b2b_annual' THEN v_end - INTERVAL '1 year'
      ELSE v_end - INTERVAL '1 month'
    END;
  ELSE
    -- Tier-based access without a stored expiry: use a rolling calendar month.
    v_start := date_trunc('month', now());
    v_end := date_trunc('month', now()) + INTERVAL '1 month';
    v_type := COALESCE(v_profile.subscription_type, 'monthly');
  END IF;

  -- Grant enough included credits for the plan's full ebook allowance at the
  -- longest book price (6 credits), so the advertised count is always usable.
  v_granted := CASE v_type
    WHEN 'monthly' THEN 24
    WHEN 'quarterly' THEN 48
    WHEN 'biennial' THEN 96
    WHEN 'annual' THEN 192
    WHEN 'b2b_quarterly' THEN 144
    WHEN 'b2b_annual' THEN 144
    ELSE 24
  END;

  INSERT INTO public.bookmaker_subscription_credits
    (user_id, subscription_type, period_start, period_end, credits_granted)
  VALUES
    (p_user_id, v_type, v_start, v_end, v_granted)
  ON CONFLICT (user_id, period_start, period_end) DO UPDATE
    SET subscription_type = EXCLUDED.subscription_type,
        credits_granted = GREATEST(
          public.bookmaker_subscription_credits.credits_granted,
          EXCLUDED.credits_granted
        )
  RETURNING * INTO v_grant;

  RETURN v_grant;
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_ensure_subscription_grant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_ensure_subscription_grant(UUID) TO service_role;
