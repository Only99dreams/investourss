-- ============================================================
-- 1) Indirect (level-2) commission bonus: 2% -> 5%
-- 2) Referral link reliability
-- ============================================================
-- (1) The ambassador indirect bonus was hard-coded at 2% in
--     record_ambassador_commission(). The business has moved it to 5%, so
--     the rate and the copy shown in wallet/notification rows are updated
--     here. The function is rewritten in full because the rate is a DECLARE
--     default, which cannot be altered in place.
--
-- (2) The referral link kept "not working" for three reasons:
--       a. profiles.referral_code was never backfilled, so any account created
--          before the column existed produced "/signup?ref=null" and every
--          shared link was dead on arrival.
--       b. record_referral_click() compared referral_code case-sensitively, so
--          a lower-cased shared code silently recorded nothing.
--       c. There was no way for a user to tell whether a code they pasted was
--          real, so a typo looked identical to a working link.
--     This migration backfills missing codes, makes the click lookup
--     case-insensitive, adds resolve_referral_code() for validation and
--     regenerate_referral_code() as a self-service repair for the rare
--     profile that still ends up without a usable code.

-- ------------------------------------------------------------------
-- 1. Indirect bonus at 5%
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
  v_direct_rate NUMERIC := 0.30;     -- 30% first-time
  v_recurring_rate NUMERIC := 0.15;  -- 15% recurring
  -- Indirect (level-2) bonus
  v_indirect_rate NUMERIC := 0.05;
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

  -- ============ INDIRECT INCOME (5% level-2 bonus) ============
  -- Resolve the middle person's referrer; if THAT user is an active
  -- ambassador they earn 5% of this customer's payment.
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
              'Ambassador indirect bonus (5%) on referral network purchase',
              'ambassador_commission',
              'completed'
            );

            INSERT INTO notifications (user_id, title, message, type)
            VALUES (
              v_indirect_referrer_id,
              'Ambassador Indirect Bonus Earned!',
              'You earned ₦' || v_indirect_amount::TEXT || ' (5% indirect bonus) from your referral network.',
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
-- legacy investment commission trigger pays the same 5%.
INSERT INTO public.system_settings (key, value)
VALUES ('indirect_subscription_commission', '0.05')
ON CONFLICT (key) DO UPDATE SET value = '0.05';

-- ------------------------------------------------------------------
-- 2. Referral link reliability
-- ------------------------------------------------------------------

-- 2a. Backfill missing / placeholder referral codes.
DO $$
DECLARE
  r          RECORD;
  v_new_code TEXT;
  v_fixed    INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.profiles
    WHERE referral_code IS NULL
       OR BTRIM(referral_code) = ''
       OR referral_code IN ('null', 'undefined')
  LOOP
    -- generate_referral_code() is random, so retry until unique.
    LOOP
      v_new_code := public.generate_referral_code();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE referral_code = v_new_code
      );
    END LOOP;

    UPDATE public.profiles
    SET referral_code = v_new_code
    WHERE id = r.id;

    v_fixed := v_fixed + 1;
  END LOOP;

  RAISE NOTICE 'Backfilled referral_code for % profile(s)', v_fixed;
END;
$$;

-- 2b. Case-insensitive click tracking (a shared code is easy to lower-case).
CREATE OR REPLACE FUNCTION public.record_referral_click(p_code TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM public.profiles
  WHERE UPPER(referral_code) = UPPER(BTRIM(COALESCE(p_code, '')))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.referral_stats (user_id, total_clicks, created_at, updated_at)
  VALUES (v_user_id, 1, now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET total_clicks = public.referral_stats.total_clicks + 1,
                updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_referral_click(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_referral_click(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.record_referral_click(TEXT) TO authenticated;

-- 2c. Validate a code on the signup form so a typo is visible immediately.
CREATE OR REPLACE FUNCTION public.resolve_referral_code(p_referral_code TEXT)
RETURNS TABLE (
  found BOOLEAN,
  referrer_id UUID,
  referrer_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT := UPPER(BTRIM(COALESCE(p_referral_code, '')));
BEGIN
  IF v_code = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT TRUE, p.id, p.full_name
  FROM public.profiles p
  WHERE UPPER(p.referral_code) = v_code
  LIMIT 1;

  -- No match: return a single "not found" row so the client always gets a row.
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_referral_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_referral_code(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.resolve_referral_code(TEXT) TO authenticated;

-- 2d. Self-service repair for a profile that still has no usable code.
CREATE OR REPLACE FUNCTION public.regenerate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_new_code TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  LOOP
    v_new_code := public.generate_referral_code();
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE referral_code = v_new_code
    );
  END LOOP;

  UPDATE public.profiles
  SET referral_code = v_new_code
  WHERE id = v_user_id;

  RETURN v_new_code;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_referral_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_referral_code() TO authenticated;
