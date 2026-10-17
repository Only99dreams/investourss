-- ============================================================
-- Subscription pricing refresh + FHA commission structure 40/20/10
-- ============================================================
-- 1) Public Premium plan pricing (effective 2026-10-17):
--      monthly       N7,650
--      quarterly     N20,400
--      biennial      N38,250
--      annual        N76,500
--      b2b_quarterly N360,000   (unchanged)
--      b2b_annual    N120,000   (grandfathered legacy price)
--    Paystack is charged the amount the client computes (base + 7.5% VAT);
--    subscription_price_for_plan() is the one server-side price map, kept in
--    step here so the legacy tier-upgrade reward follows the new prices.
--
-- 2) FHA ambassador commission structure:
--      * 40% first-time commission  (was 30%)
--      * 20% recurring commission   (was 15%)
--      * 10% indirect (level-2) bonus (was 5%)
--    Rates are applied to the VAT-exclusive actual price (amount / 1.075).
--    record_ambassador_commission() is rewritten in full because the rates
--    are DECLARE defaults, which cannot be altered in place.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Server-side price map
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_price_for_plan(p_plan_type TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_plan_type
    WHEN 'monthly'       THEN 7650
    WHEN 'quarterly'     THEN 20400
    WHEN 'biennial'      THEN 38250
    WHEN 'annual'        THEN 76500
    WHEN 'b2b_quarterly' THEN 360000
    WHEN 'b2b_annual'    THEN 120000
    ELSE 7650
  END::NUMERIC;
$$;

REVOKE ALL ON FUNCTION public.subscription_price_for_plan(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_price_for_plan(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_price_for_plan(TEXT) TO anon;

-- ------------------------------------------------------------------
-- 2. FHA ambassador commission: 40% first-time / 20% recurring / 10% indirect
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
  v_direct_rate NUMERIC := 0.40;     -- 40% first-time
  v_recurring_rate NUMERIC := 0.20;  -- 20% recurring
  -- Indirect (level-2) bonus
  v_indirect_rate NUMERIC := 0.10;
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

    -- A referral earns first_time (40%) exactly once; anything after is recurring (20%).
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

-- Keep the admin-settings-driven rate in step with the hard-coded one so the
-- legacy investment commission trigger pays the same 10%.
INSERT INTO public.system_settings (key, value)
VALUES ('indirect_subscription_commission', '0.10')
ON CONFLICT (key) DO UPDATE SET value = '0.10';
