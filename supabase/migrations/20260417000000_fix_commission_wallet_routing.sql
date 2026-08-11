-- Fix commission wallet routing:
-- 1. Commissions go to gfe_wallet_balance (GFE Wallet), not user_wallet_balance
-- 2. Commission is calculated on the actual base price paid (after promo, before VAT)
-- 3. Direct = 40%, Indirect = 5%

-- ============================================================
-- Fix handle_tier_upgrade_reward() — fires when user_tier changes on profiles
-- This is the main subscription commission path
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_tier_upgrade_reward()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referrer_id UUID;
  indirect_referrer_id UUID;
  direct_rate DECIMAL;
  indirect_rate DECIMAL;
  actual_paid DECIMAL;
  base_after_promo DECIMAL;
  reward_amount DECIMAL;
  indirect_reward DECIMAL;
  referrer_wallet_id UUID;
  indirect_wallet_id UUID;
  vat_rate DECIMAL := 0.075;
BEGIN
  -- Only trigger on tier upgrade to premium/exclusive (not downgrade)
  IF OLD.user_tier = 'free' AND NEW.user_tier IN ('premium', 'exclusive') THEN

    -- Get direct referrer
    SELECT referred_by INTO referrer_id FROM profiles WHERE id = NEW.id;

    IF referrer_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Get configurable rates from system_settings
    SELECT (value::text)::decimal INTO direct_rate
    FROM system_settings WHERE key = 'direct_subscription_commission';

    SELECT (value::text)::decimal INTO indirect_rate
    FROM system_settings WHERE key = 'indirect_subscription_commission';

    -- Defaults: 40% direct, 5% indirect
    direct_rate := COALESCE(direct_rate, 0.40);
    indirect_rate := COALESCE(indirect_rate, 0.05);

    -- Look up the actual amount paid from the most recent approved subscription deposit
    SELECT dr.amount INTO actual_paid
    FROM deposit_requests dr
    WHERE dr.user_id = NEW.id
      AND dr.status = 'approved'
      AND (dr.narration LIKE '%subscription%' OR dr.narration LIKE '%Premium%')
    ORDER BY dr.processed_at DESC NULLS LAST, dr.created_at DESC
    LIMIT 1;

    -- If no deposit found (e.g. free promo activation), no commission
    IF actual_paid IS NULL OR actual_paid <= 0 THEN
      RETURN NEW;
    END IF;

    -- Back out VAT to get base price after promo
    -- amount_stored = base_after_promo * (1 + 0.075)
    base_after_promo := actual_paid / (1 + vat_rate);

    -- === Direct referrer commission ===
    reward_amount := base_after_promo * direct_rate;

    SELECT id INTO referrer_wallet_id FROM wallets WHERE user_id = referrer_id;

    IF referrer_wallet_id IS NOT NULL AND reward_amount > 0 THEN
      -- Credit GFE wallet
      UPDATE wallets
      SET gfe_wallet_balance = gfe_wallet_balance + reward_amount,
          updated_at = now()
      WHERE id = referrer_wallet_id;

      INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
      VALUES (
        referrer_wallet_id,
        reward_amount,
        'credit',
        'Direct referral commission (40% of ₦' || ROUND(base_after_promo, 2)::TEXT || ')',
        'referral_system',
        'completed'
      );

      UPDATE referral_stats
      SET total_subscribed = total_subscribed + 1,
          total_earnings = total_earnings + reward_amount,
          updated_at = now()
      WHERE user_id = referrer_id;

      INSERT INTO notifications (user_id, title, message, type)
      VALUES (
        referrer_id,
        'Commission Earned!',
        'You earned ₦' || ROUND(reward_amount, 2)::TEXT || ' direct commission from a subscription referral. Check your GFE Wallet.',
        'referral_reward'
      );
    END IF;

    -- === Indirect referrer commission (2nd level) ===
    SELECT referred_by INTO indirect_referrer_id FROM profiles WHERE id = referrer_id;

    IF indirect_referrer_id IS NOT NULL THEN
      indirect_reward := base_after_promo * indirect_rate;

      SELECT id INTO indirect_wallet_id FROM wallets WHERE user_id = indirect_referrer_id;

      IF indirect_wallet_id IS NOT NULL AND indirect_reward > 0 THEN
        UPDATE wallets
        SET gfe_wallet_balance = gfe_wallet_balance + indirect_reward,
            updated_at = now()
        WHERE id = indirect_wallet_id;

        INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
        VALUES (
          indirect_wallet_id,
          indirect_reward,
          'credit',
          'Indirect referral commission (5% of ₦' || ROUND(base_after_promo, 2)::TEXT || ')',
          'referral_system',
          'completed'
        );

        UPDATE referral_stats
        SET total_earnings = total_earnings + indirect_reward,
            updated_at = now()
        WHERE user_id = indirect_referrer_id;

        INSERT INTO notifications (user_id, title, message, type)
        VALUES (
          indirect_referrer_id,
          'Commission Earned!',
          'You earned ₦' || ROUND(indirect_reward, 2)::TEXT || ' indirect commission from a referral. Check your GFE Wallet.',
          'referral_reward'
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- Fix calculate_referral_reward() — fires on user_investments
-- Investment commission path (also route to GFE wallet)
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_referral_reward()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referrer_id UUID;
  indirect_referrer_id UUID;
  investment_direct_rate DECIMAL;
  investment_indirect_rate DECIMAL;
  reward_amount DECIMAL;
  indirect_reward DECIMAL;
  referrer_wallet_id UUID;
  indirect_wallet_id UUID;
BEGIN
  -- Get configurable rates from system_settings
  SELECT (value::text)::decimal INTO investment_direct_rate
  FROM system_settings WHERE key = 'direct_investment_commission';

  SELECT (value::text)::decimal INTO investment_indirect_rate
  FROM system_settings WHERE key = 'indirect_investment_commission';

  -- Defaults
  investment_direct_rate := COALESCE(investment_direct_rate, 0.05);
  investment_indirect_rate := COALESCE(investment_indirect_rate, 0.02);

  -- Get direct referrer
  SELECT referred_by INTO referrer_id FROM profiles WHERE id = NEW.user_id;

  IF referrer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Investment reward
  reward_amount := NEW.amount * investment_direct_rate;

  UPDATE referral_stats
  SET total_investing = total_investing + 1,
      total_earnings = total_earnings + reward_amount,
      updated_at = now()
  WHERE user_id = referrer_id;

  -- Get referrer's wallet
  SELECT id INTO referrer_wallet_id FROM wallets WHERE user_id = referrer_id;

  IF referrer_wallet_id IS NOT NULL AND reward_amount > 0 THEN
    -- Credit GFE wallet
    UPDATE wallets
    SET gfe_wallet_balance = gfe_wallet_balance + reward_amount,
        updated_at = now()
    WHERE id = referrer_wallet_id;

    INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
    VALUES (
      referrer_wallet_id,
      reward_amount,
      'credit',
      'Investment referral commission',
      'referral_system',
      'completed'
    );

    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      referrer_id,
      'Commission Earned!',
      'You earned ₦' || ROUND(reward_amount, 2)::TEXT || ' commission from an investment referral. Check your GFE Wallet.',
      'referral_reward'
    );
  END IF;

  -- Handle indirect referrer (2nd level)
  SELECT referred_by INTO indirect_referrer_id FROM profiles WHERE id = referrer_id;

  IF indirect_referrer_id IS NOT NULL THEN
    indirect_reward := NEW.amount * investment_indirect_rate;

    SELECT id INTO indirect_wallet_id FROM wallets WHERE user_id = indirect_referrer_id;

    IF indirect_wallet_id IS NOT NULL AND indirect_reward > 0 THEN
      UPDATE wallets
      SET gfe_wallet_balance = gfe_wallet_balance + indirect_reward,
          updated_at = now()
      WHERE id = indirect_wallet_id;

      INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
      VALUES (
        indirect_wallet_id,
        indirect_reward,
        'credit',
        'Indirect investment referral commission',
        'referral_system',
        'completed'
      );

      UPDATE referral_stats
      SET total_earnings = total_earnings + indirect_reward,
          updated_at = now()
      WHERE user_id = indirect_referrer_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
