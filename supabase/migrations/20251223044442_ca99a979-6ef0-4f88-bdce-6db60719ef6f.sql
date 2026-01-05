-- Create referral reward calculation function
CREATE OR REPLACE FUNCTION public.calculate_referral_reward()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  referrer_id UUID;
  indirect_referrer_id UUID;
  direct_rate DECIMAL := 0.30; -- 30% for direct referrals
  indirect_rate DECIMAL := 0.10; -- 10% for indirect referrals
  investment_direct_rate DECIMAL := 0.05; -- 5% of investment amount for direct
  investment_indirect_rate DECIMAL := 0.02; -- 2% for indirect
  reward_amount DECIMAL;
  indirect_reward DECIMAL;
  referrer_wallet_id UUID;
  indirect_wallet_id UUID;
  subscription_amount DECIMAL := 5000; -- Base subscription amount
  reward_type TEXT;
BEGIN
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

-- Create trigger for investment referral rewards
DROP TRIGGER IF EXISTS on_investment_referral_reward ON user_investments;
CREATE TRIGGER on_investment_referral_reward
AFTER INSERT ON user_investments
FOR EACH ROW
EXECUTE FUNCTION calculate_referral_reward();

-- Create function for tier upgrade rewards
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
  subscription_amount DECIMAL := 5000;
  direct_rate DECIMAL := 0.30;
BEGIN
  -- Only trigger on tier upgrade (not downgrade)
  IF OLD.user_tier = 'free' AND NEW.user_tier IN ('premium', 'exclusive') THEN
    -- Get referrer
    SELECT referred_by INTO referrer_id FROM profiles WHERE id = NEW.id;
    
    IF referrer_id IS NOT NULL THEN
      reward_amount := subscription_amount * direct_rate;
      
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

-- Create trigger for tier upgrade
DROP TRIGGER IF EXISTS on_tier_upgrade_reward ON profiles;
CREATE TRIGGER on_tier_upgrade_reward
AFTER UPDATE OF user_tier ON profiles
FOR EACH ROW
EXECUTE FUNCTION handle_tier_upgrade_reward();

-- Create function to track referral signups
CREATE OR REPLACE FUNCTION public.track_referral_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.referred_by IS NOT NULL THEN
    -- Update referrer's stats
    UPDATE referral_stats 
    SET total_signups = total_signups + 1,
        updated_at = now()
    WHERE user_id = NEW.referred_by;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for signup tracking (on profile creation since profiles are created after auth.users)
DROP TRIGGER IF EXISTS on_referral_signup ON profiles;
CREATE TRIGGER on_referral_signup
AFTER INSERT ON profiles
FOR EACH ROW
EXECUTE FUNCTION track_referral_signup();