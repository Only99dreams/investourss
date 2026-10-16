-- ============================================================
-- Subscription pricing update (effective 2026-10-16)
-- ============================================================
-- New public Premium plan pricing:
--   monthly       N7,200
--   quarterly     N19,200
--   biennial      N36,000
--   annual        N72,000
--   b2b_quarterly N360,000   (unchanged)
--   b2b_annual    N120,000   (grandfathered legacy price)
--
-- Paystack is charged the amount the client computes (base + 7.5% VAT), and
-- the ambassador commission RPC (record_ambassador_commission) already derives
-- its payout from the ACTUAL amount paid (amount / 1.075 * rate). Nothing in
-- the payment/commission path is price-quoted server-side, so those flows
-- automatically follow the new prices.
--
-- The one remaining server-side hard-coded subscription value is the legacy
-- non-ambassador referral reward in handle_tier_upgrade_reward(), which paid
-- 30% of a flat N5,000 regardless of plan. It is rewritten to pay 30% of the
-- real plan price so legacy referrers stay consistent with the new pricing.
-- ============================================================

CREATE OR REPLACE FUNCTION public.subscription_price_for_plan(p_plan_type TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_plan_type
    WHEN 'monthly'       THEN 7200
    WHEN 'quarterly'     THEN 19200
    WHEN 'biennial'      THEN 36000
    WHEN 'annual'        THEN 72000
    WHEN 'b2b_quarterly' THEN 360000
    WHEN 'b2b_annual'    THEN 120000
    ELSE 7200
  END::NUMERIC;
$$;

REVOKE ALL ON FUNCTION public.subscription_price_for_plan(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_price_for_plan(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_price_for_plan(TEXT) TO anon;

CREATE OR REPLACE FUNCTION public.handle_tier_upgrade_reward()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referrer_id UUID;
  reward_amount DECIMAL;
  referrer_wallet_id UUID;
  direct_rate DECIMAL := 0.30;
  subscription_price DECIMAL;
BEGIN
  -- Only trigger on tier upgrade (not downgrade)
  IF OLD.user_tier = 'free' AND NEW.user_tier IN ('premium', 'exclusive') THEN
    -- Get referrer
    SELECT referred_by INTO referrer_id FROM profiles WHERE id = NEW.id;

    IF referrer_id IS NOT NULL THEN
      -- Skip legacy credit for active ambassadors: the FHA commission RPC
      -- now owns their subscription referral payout.
      IF EXISTS (SELECT 1 FROM ambassadors WHERE user_id = referrer_id AND is_active) THEN
        RETURN NEW;
      END IF;

      -- Reward = 30% of the plan the member just bought.
      subscription_price := public.subscription_price_for_plan(NEW.subscription_type);
      reward_amount := subscription_price * direct_rate;

      -- Get referrer's wallet
      SELECT id INTO referrer_wallet_id FROM wallets WHERE user_id = referrer_id;

      IF referrer_wallet_id IS NOT NULL THEN
        -- Credit wallet
        UPDATE wallets
        SET user_wallet_balance = user_wallet_balance + reward_amount,
            updated_at = now()
        WHERE id = referrer_wallet_id;

        -- Create transaction
        INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
        VALUES (referrer_wallet_id, reward_amount, 'credit', 'Subscription referral reward', 'referral_system', 'completed');

        -- Update referral stats
        UPDATE referral_stats
        SET total_subscribed = total_subscribed + 1,
            total_earnings = total_earnings + reward_amount,
            updated_at = now()
        WHERE user_id = referrer_id;

        -- Notify referrer
        INSERT INTO notifications (user_id, title, message, type)
        VALUES (referrer_id, 'Subscription Referral Reward!', 'You earned ₦' || reward_amount::TEXT || ' from a subscription referral.', 'referral_reward');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
