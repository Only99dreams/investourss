-- ============================================================
-- Migration: Update referral commission, add referral leaderboard,
-- add payment approval function, and add bi-annual plan support
-- ============================================================

-- Update referral reward function default rates (40% -> 30% direct)
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
  subscription_amount DECIMAL := 5000;
  reward_type TEXT;
BEGIN
  SELECT (value::text)::decimal INTO direct_rate
  FROM system_settings WHERE key = 'direct_subscription_commission';

  SELECT (value::text)::decimal INTO indirect_rate
  FROM system_settings WHERE key = 'indirect_subscription_commission';

  SELECT (value::text)::decimal INTO investment_direct_rate
  FROM system_settings WHERE key = 'direct_investment_commission';

  SELECT (value::text)::decimal INTO investment_indirect_rate
  FROM system_settings WHERE key = 'indirect_investment_commission';

  -- Updated defaults: 30% direct, 5% indirect
  direct_rate := COALESCE(direct_rate, 0.30);
  indirect_rate := COALESCE(indirect_rate, 0.05);
  investment_direct_rate := COALESCE(investment_direct_rate, 0.05);
  investment_indirect_rate := COALESCE(investment_indirect_rate, 0.02);

  SELECT referred_by INTO referrer_id FROM profiles WHERE id = NEW.user_id;

  IF referrer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'user_investments' THEN
    reward_amount := NEW.amount * investment_direct_rate;
    reward_type := 'investment_referral';

    UPDATE referral_stats
    SET total_investing = total_investing + 1,
        total_earnings = total_earnings + reward_amount,
        updated_at = now()
    WHERE user_id = referrer_id;

  ELSE
    reward_amount := subscription_amount * direct_rate;
    reward_type := 'subscription_referral';

    UPDATE referral_stats
    SET total_subscribed = total_subscribed + 1,
        total_earnings = total_earnings + reward_amount,
        updated_at = now()
    WHERE user_id = referrer_id;
  END IF;

  SELECT id INTO referrer_wallet_id FROM wallets WHERE user_id = referrer_id;

  IF referrer_wallet_id IS NOT NULL AND reward_amount > 0 THEN
    UPDATE wallets
    SET user_wallet_balance = user_wallet_balance + reward_amount,
        updated_at = now()
    WHERE id = referrer_wallet_id;

    INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
    VALUES (
      referrer_wallet_id,
      reward_amount,
      'credit',
      'Referral reward for ' || reward_type,
      'referral_system',
      'completed'
    );

    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      referrer_id,
      'Referral Reward Earned!',
      'You earned ₦' || reward_amount::TEXT || ' from your referral.',
      'referral_reward'
    );
  END IF;

  SELECT referred_by INTO indirect_referrer_id FROM profiles WHERE id = referrer_id;

  IF indirect_referrer_id IS NOT NULL THEN
    IF TG_TABLE_NAME = 'user_investments' THEN
      indirect_reward := NEW.amount * investment_indirect_rate;
    ELSE
      indirect_reward := subscription_amount * indirect_rate;
    END IF;

    SELECT id INTO indirect_wallet_id FROM wallets WHERE user_id = indirect_referrer_id;

    IF indirect_wallet_id IS NOT NULL AND indirect_reward > 0 THEN
      UPDATE wallets
      SET user_wallet_balance = user_wallet_balance + indirect_reward,
          updated_at = now()
      WHERE id = indirect_wallet_id;

      INSERT INTO wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
      VALUES (
        indirect_wallet_id,
        indirect_reward,
        'credit',
        'Indirect referral reward',
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

-- Referral Leaderboard RPC
CREATE OR REPLACE FUNCTION public.get_referral_leaderboard()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  referral_count bigint,
  total_earnings decimal,
  rank bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS user_id,
    p.full_name,
    COALESCE(rs.total_signups, 0) AS referral_count,
    COALESCE(rs.total_earnings, 0) AS total_earnings,
    ROW_NUMBER() OVER (ORDER BY COALESCE(rs.total_signups, 0) DESC, COALESCE(rs.total_earnings, 0) DESC) AS rank
  FROM public.profiles AS p
  LEFT JOIN public.referral_stats AS rs ON rs.user_id = p.id
  WHERE EXISTS (
    SELECT 1 FROM public.profiles AS referred
    WHERE referred.referred_by = p.id
  )
  ORDER BY referral_count DESC, total_earnings DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_referral_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_leaderboard() TO anon;
GRANT EXECUTE ON FUNCTION public.get_referral_leaderboard() TO authenticated;

-- Function to approve deposit/payment and activate subscription
CREATE OR REPLACE FUNCTION public.approve_deposit_request(
  p_deposit_id UUID,
  p_admin_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_amount DECIMAL;
  v_narration TEXT;
BEGIN
  -- Get the deposit request
  SELECT user_id, amount, narration INTO v_user_id, v_amount, v_narration
  FROM public.deposit_requests
  WHERE id = p_deposit_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit request not found or already processed';
  END IF;

  -- Update deposit request status
  UPDATE public.deposit_requests
  SET status = 'approved',
      admin_reviewed_at = now(),
      admin_reviewed_by = p_admin_id
  WHERE id = p_deposit_id;

  -- If this is a subscription payment, activate premium
  IF v_narration LIKE 'Premium subscription - %' OR v_narration LIKE 'Premium%' THEN
    UPDATE public.profiles
    SET user_tier = 'premium',
        updated_at = now()
    WHERE id = v_user_id AND user_tier = 'free';
  END IF;

  -- Credit the user's wallet
  INSERT INTO public.wallet_transactions (wallet_id, amount, transaction_type, narration, source, status, actor_id)
  SELECT
    w.id,
    v_amount,
    'credit',
    'Deposit approved: ' || v_narration,
    'deposit_approval',
    'completed',
    p_admin_id
  FROM public.wallets w
  WHERE w.user_id = v_user_id;

  UPDATE public.wallets
  SET user_wallet_balance = user_wallet_balance + v_amount,
      updated_at = now()
  WHERE user_id = v_user_id;

  -- Create notification
  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    v_user_id,
    'Deposit Approved!',
    'Your deposit of ₦' || v_amount::TEXT || ' has been approved and credited to your wallet.',
    'deposit_approved'
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_deposit_request(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_deposit_request(UUID, UUID) TO authenticated;

-- Update the activate_free_subscription to support biennial
CREATE OR REPLACE FUNCTION public.activate_free_subscription(
  p_user_id UUID,
  p_plan_type TEXT,
  p_promo_code_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  admin_user RECORD;
BEGIN
  SELECT id INTO admin_user FROM profiles WHERE role IN ('admin', 'super_admin') LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No admin user found for transaction processing';
  END IF;

  INSERT INTO promo_code_uses (
    promo_code_id,
    user_id,
    discount_applied,
    plan_type
  ) VALUES (
    p_promo_code_id,
    p_user_id,
    0,
    p_plan_type
  );

  UPDATE promo_codes
  SET used_count = used_count + 1
  WHERE id = p_promo_code_id;

  UPDATE profiles
  SET user_tier = 'premium',
      subscription_type = p_plan_type,
      updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO wallet_transactions (
    wallet_id,
    amount,
    transaction_type,
    narration,
    source,
    status,
    actor_id
  )
  SELECT
    w.id,
    0,
    'credit',
    CONCAT('Free Premium Subscription - ', p_plan_type, ' (100% discount)'),
    'subscription_payment',
    'completed',
    admin_user.id
  FROM wallets w WHERE w.user_id = p_user_id;

  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    p_user_id,
    '🎉 Premium Subscription Activated!',
    CONCAT('Your premium subscription has been activated for free! You now have access to all premium features for the ', p_plan_type, ' plan.'),
    'subscription_activated'
  );

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update system_settings with new default commission rate
INSERT INTO public.system_settings (key, value) VALUES
  ('direct_subscription_commission', '0.30')
ON CONFLICT (key) DO UPDATE SET value = '0.30';

-- Update process_deposit_request to handle biennial and b2b_annual plan types
CREATE OR REPLACE FUNCTION public.process_deposit_request(
  request_id UUID,
  admin_id UUID,
  action TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deposit_record RECORD;
  admin_profile RECORD;
  narration_text TEXT;
BEGIN
  SELECT * INTO deposit_record FROM deposit_requests WHERE id = request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit request not found';
  END IF;

  SELECT full_name INTO admin_profile FROM profiles WHERE id = admin_id;

  IF action = 'approve' THEN
    UPDATE deposit_requests
    SET status = 'approved',
        processed_by = admin_id,
        processed_at = NOW(),
        narration = CONCAT('Approved by ', COALESCE(admin_profile.full_name, 'Admin'), ' - Manual Bank Transfer')
    WHERE id = request_id;

    IF deposit_record.narration LIKE '%subscription%' OR deposit_record.narration LIKE '%Premium%' THEN
      UPDATE profiles
      SET user_tier = 'premium',
          subscription_type = CASE
            WHEN deposit_record.narration LIKE '%monthly%' THEN 'monthly'
            WHEN deposit_record.narration LIKE '%quarterly%' THEN 'quarterly'
            WHEN deposit_record.narration LIKE '%biennial%' OR deposit_record.narration LIKE '%bi-annual%' THEN 'biennial'
            WHEN deposit_record.narration LIKE '%annual%' THEN 'annual'
            WHEN deposit_record.narration LIKE '%b2b%' THEN 'b2b_annual'
            ELSE 'monthly'
          END,
          updated_at = NOW()
      WHERE id = deposit_record.user_id;

      INSERT INTO wallet_transactions (
        wallet_id,
        amount,
        transaction_type,
        narration,
        source,
        status,
        actor_id
      )
      SELECT
        w.id,
        deposit_record.amount,
        'credit',
        CONCAT('Premium Subscription - Approved by ', COALESCE(admin_profile.full_name, 'Admin')),
        'subscription_payment',
        'completed',
        admin_id
      FROM wallets w WHERE w.user_id = deposit_record.user_id;

      INSERT INTO notifications (user_id, title, message, type)
      VALUES (
        deposit_record.user_id,
        '🎉 Premium Subscription Activated!',
        CONCAT('Your premium subscription has been activated! You now have access to all premium features.'),
        'subscription_activated'
      );

    ELSE
      UPDATE wallets
      SET user_wallet_balance = user_wallet_balance + deposit_record.amount,
          updated_at = NOW()
      WHERE user_id = deposit_record.user_id;

      INSERT INTO wallet_transactions (
        wallet_id,
        amount,
        transaction_type,
        narration,
        source,
        status,
        actor_id
      )
      SELECT
        w.id,
        deposit_record.amount,
        'credit',
        CONCAT('Manual Bank Transfer - Approved by ', COALESCE(admin_profile.full_name, 'Admin')),
        'manual_deposit',
        'completed',
        admin_id
      FROM wallets w WHERE w.user_id = deposit_record.user_id;

      INSERT INTO notifications (user_id, title, message, type)
      VALUES (
        deposit_record.user_id,
        '💰 Deposit Approved',
        CONCAT('Your manual bank transfer of ₦', deposit_record.amount::text, ' has been approved and credited to your wallet.'),
        'deposit_approved'
      );
    END IF;

  ELSIF action = 'reject' THEN
    UPDATE deposit_requests
    SET status = 'rejected',
        processed_by = admin_id,
        processed_at = NOW(),
        narration = CONCAT('Rejected by ', COALESCE(admin_profile.full_name, 'Admin'))
    WHERE id = request_id;

    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      deposit_record.user_id,
      '❌ Deposit Rejected',
      CONCAT('Your manual bank transfer request of ₦', deposit_record.amount::text, ' has been rejected. Please contact support for details.'),
      'deposit_rejected'
    );
  END IF;

  RETURN TRUE;
END;
$$;
