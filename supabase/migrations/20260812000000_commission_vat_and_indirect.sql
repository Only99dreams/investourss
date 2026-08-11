-- Ambassador earning model (Direct + Indirect)
--
-- Direct income:
--   * 30% first-time commission when a referred user pays for an Audit Credit
--     Pack or Subscription for the first time.
--   * 15% recurring commission on each repurchase / renewal.
--   * Commission is calculated on the ACTUAL PRICE (VAT not included), i.e.
--     the gross amount paid to Paystack (which now includes 7.5% VAT) is
--     reduced to its VAT-exclusive base before applying the rate.
--
-- Indirect income:
--   * 2% bonus on every payment made by a referred user's referred users
--     (level-2 downline) and on their repurchases / renewals.
--   Example: Mose -> Emma -> Daniel. Daniel pays: Emma earns 30%/15% directly
--   and Mose earns 2% as an indirect bonus on that same payment.

-- ============================================================
-- 1. Allow the 'indirect' commission type
-- ============================================================
ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_commission_type_check;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_commission_type_check
  CHECK (commission_type IN ('first_time', 'recurring', 'indirect'));

-- ============================================================
-- 2. Rewrite record_ambassador_commission
-- ============================================================
DROP FUNCTION IF EXISTS public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN);

CREATE OR REPLACE FUNCTION public.record_ambassador_commission(
  p_user_id UUID,
  p_amount NUMERIC,
  p_is_renewal BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  commission_id UUID,
  amount NUMERIC,
  commission_type TEXT,
  ambassador_id UUID,
  referral_id UUID
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

    -- Record the commission
    INSERT INTO commissions (ambassador_id, referral_id, amount, commission_type)
    VALUES (v_ambassador_id, v_referral_id, v_commission_amount, v_commission_type)
    RETURNING id INTO v_commission_id;

    -- Mirror into the ambassador's running total
    UPDATE ambassadors
    SET total_earnings = total_earnings + v_commission_amount,
        updated_at = now()
    WHERE id = v_ambassador_id;

    -- Credit the ambassador's wallet (if one exists)
    SELECT id INTO v_direct_wallet_id
    FROM wallets
    WHERE user_id = v_referrer_id;

    IF v_direct_wallet_id IS NOT NULL AND v_commission_amount > 0 THEN
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

          INSERT INTO commissions (ambassador_id, referral_id, amount, commission_type)
          VALUES (v_indirect_ambassador_id, v_indirect_referral_id, v_indirect_amount, 'indirect');

          UPDATE ambassadors
          SET total_earnings = total_earnings + v_indirect_amount,
              updated_at = now()
          WHERE id = v_indirect_ambassador_id;

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

REVOKE ALL ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_ambassador_commission(UUID, NUMERIC, BOOLEAN) TO anon;
