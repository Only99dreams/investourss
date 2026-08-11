-- Insert default withdrawal fee rates into system_settings
INSERT INTO public.system_settings (key, value) VALUES
  ('general_withdrawal_fee', '0.15'),
  ('premium_withdrawal_fee', '0.10')
ON CONFLICT (key) DO NOTHING;

-- Update referral reward calculation function to use configurable rates
CREATE OR REPLACE FUNCTION public.calculate_referral_reward()
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
  investment_direct_rate DECIMAL;
  investment_indirect_rate DECIMAL;
  reward_amount DECIMAL;
  indirect_reward DECIMAL;
  referrer_wallet_id UUID;
  indirect_wallet_id UUID;
  subscription_amount DECIMAL := 5000; -- Base subscription amount
  reward_type TEXT;
BEGIN
  -- Get configurable rates from system_settings
  SELECT (value::text)::decimal INTO direct_rate
  FROM system_settings WHERE key = 'direct_subscription_commission';

  SELECT (value::text)::decimal INTO indirect_rate
  FROM system_settings WHERE key = 'indirect_subscription_commission';

  SELECT (value::text)::decimal INTO investment_direct_rate
  FROM system_settings WHERE key = 'direct_investment_commission';

  SELECT (value::text)::decimal INTO investment_indirect_rate
  FROM system_settings WHERE key = 'indirect_investment_commission';

  -- Set defaults if not configured
  direct_rate := COALESCE(direct_rate, 0.40);
  indirect_rate := COALESCE(indirect_rate, 0.05);
  investment_direct_rate := COALESCE(investment_direct_rate, 0.05);
  investment_indirect_rate := COALESCE(investment_indirect_rate, 0.02);

  -- Get direct referrer from profiles
  SELECT referred_by INTO referrer_id FROM profiles WHERE id = NEW.user_id;

  IF referrer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Determine reward type and amount based on trigger source
  IF TG_TABLE_NAME = 'user_investments' THEN
    -- Investment reward
    reward_amount := NEW.amount * investment_direct_rate;
    reward_type := 'investment_referral';

    -- Update referral stats for investing
    UPDATE referral_stats
    SET total_investing = total_investing + 1,
        total_earnings = total_earnings + reward_amount,
        updated_at = now()
    WHERE user_id = referrer_id;

  ELSE
    -- Subscription reward (tier upgrade)
    reward_amount := subscription_amount * direct_rate;
    reward_type := 'subscription_referral';

    -- Update referral stats for subscribed
    UPDATE referral_stats
    SET total_subscribed = total_subscribed + 1,
        total_earnings = total_earnings + reward_amount,
        updated_at = now()
    WHERE user_id = referrer_id;
  END IF;

  -- Get referrer's wallet
  SELECT id INTO referrer_wallet_id FROM wallets WHERE user_id = referrer_id;

  IF referrer_wallet_id IS NOT NULL AND reward_amount > 0 THEN
    -- Credit referrer's wallet
    UPDATE wallets
    SET user_wallet_balance = user_wallet_balance + reward_amount,
        updated_at = now()
    WHERE id = referrer_wallet_id;

    -- Create transaction record
    INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
    VALUES (
      referrer_wallet_id,
      reward_amount,
      'credit',
      'Referral reward for ' || reward_type,
      'referral_system',
      'completed'
    );

    -- Create notification for referrer
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      referrer_id,
      'Referral Reward Earned!',
      'You earned ₦' || reward_amount::TEXT || ' from your referral.',
      'referral_reward'
    );
  END IF;

  -- Handle indirect referrer (2nd level)
  SELECT referred_by INTO indirect_referrer_id FROM profiles WHERE id = referrer_id;

  IF indirect_referrer_id IS NOT NULL THEN
    IF TG_TABLE_NAME = 'user_investments' THEN
      indirect_reward := NEW.amount * investment_indirect_rate;
    ELSE
      indirect_reward := subscription_amount * indirect_rate;
    END IF;

    SELECT id INTO indirect_wallet_id FROM wallets WHERE user_id = indirect_referrer_id;

    IF indirect_wallet_id IS NOT NULL AND indirect_reward > 0 THEN
      -- Credit indirect referrer's wallet
      UPDATE wallets
      SET user_wallet_balance = user_wallet_balance + indirect_reward,
          updated_at = now()
      WHERE id = indirect_wallet_id;

      -- Create transaction record
      INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
      VALUES (
        indirect_wallet_id,
        indirect_reward,
        'credit',
        'Indirect referral reward',
        'referral_system',
        'completed'
      );

      -- Update indirect referrer stats
      UPDATE referral_stats
      SET total_earnings = total_earnings + indirect_reward,
          updated_at = now()
      WHERE user_id = indirect_referrer_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;