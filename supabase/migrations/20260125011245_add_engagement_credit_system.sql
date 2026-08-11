-- Add engagement credit tracking
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS engagement_credit_earned BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ai_tutor_used INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS videos_watched INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS posts_created INTEGER DEFAULT 0;

-- Create function to check and award engagement credit
CREATE OR REPLACE FUNCTION public.check_engagement_credit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_profile RECORD;
  credit_amount DECIMAL := 2000;
BEGIN
  -- Get user profile
  SELECT * INTO user_profile FROM profiles WHERE id = NEW.user_id;

  -- Only award if not already earned
  IF user_profile.engagement_credit_earned = TRUE THEN
    RETURN NEW;
  END IF;

  -- Check if all conditions are met
  IF user_profile.ai_tutor_used >= 3 AND
     user_profile.videos_watched >= 1 AND
     user_profile.posts_created >= 1 THEN

    -- Award the credit
    UPDATE profiles
    SET engagement_credit_earned = TRUE
    WHERE id = NEW.user_id;

    -- Credit user's wallet
    UPDATE wallets
    SET user_wallet_balance = user_wallet_balance + credit_amount,
        updated_at = now()
    WHERE user_id = NEW.user_id;

    -- Create transaction record
    INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
    SELECT
      w.id,
      credit_amount,
      'credit',
      'Platform Engagement Credit - Welcome bonus for active participation!',
      'engagement_credit',
      'completed'
    FROM wallets w WHERE w.user_id = NEW.user_id;

    -- Create notification
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      NEW.user_id,
      '🎉 Engagement Credit Unlocked!',
      'Congratulations! You''ve earned ₦2,000 for being actively engaged on our platform.',
      'engagement_credit'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create triggers to track engagement activities
DROP TRIGGER IF EXISTS track_ai_tutor_usage ON ai_search_logs;
CREATE TRIGGER track_ai_tutor_usage
AFTER INSERT ON ai_search_logs
FOR EACH ROW
WHEN (NEW.search_type = 'tutor' OR NEW.search_type = 'ai_tutor')
EXECUTE FUNCTION check_engagement_credit();

-- Note: We'll need to add triggers for video watching and posting when those tables are updated
-- For now, this handles AI tutor usage tracking