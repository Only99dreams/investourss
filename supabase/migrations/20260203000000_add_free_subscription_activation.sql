-- Function to activate free subscription with 100% promo code
CREATE OR REPLACE FUNCTION activate_free_subscription(
  p_user_id UUID,
  p_plan_type TEXT,
  p_promo_code_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  admin_user RECORD;
BEGIN
  -- Get an admin user for the transaction (we'll use the first admin found)
  SELECT id INTO admin_user FROM profiles WHERE role IN ('admin', 'super_admin') LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No admin user found for transaction processing';
  END IF;

  -- Record the promo code usage
  INSERT INTO promo_code_uses (
    promo_code_id,
    user_id,
    discount_applied,
    plan_type
  ) VALUES (
    p_promo_code_id,
    p_user_id,
    0, -- Free subscription
    p_plan_type
  );

  -- Increment promo code usage count
  UPDATE promo_codes
  SET used_count = used_count + 1
  WHERE id = p_promo_code_id;

  -- Update user tier to premium
  UPDATE profiles
  SET user_tier = 'premium',
      subscription_type = p_plan_type,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- Create transaction record for free subscription
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
    0, -- Free
    'credit',
    CONCAT('Free Premium Subscription - ', p_plan_type, ' (100% discount)'),
    'subscription_payment',
    'completed',
    admin_user.id
  FROM wallets w WHERE w.user_id = p_user_id;

  -- Create notification for subscription activation
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