-- B2B Subscription is now N360,000 per QUARTER (was N120,000/year) and is
-- targeted at our big promoters. Introduce a dedicated b2b_quarterly plan type
-- so the ledger, expiry and FHA portfolio can reason about it correctly.
--
--   * profiles.subscription_type    gains 'b2b_quarterly'
--   * promo_codes.plan_type         gains 'b2b_quarterly'
--   * subscription_expiry_for_plan  maps b2b_quarterly -> 90 days
--     (existing b2b_annual stays -> 365 days to grandfather legacy subscribers)
--
-- Idempotent and safe to re-run.

-- ============================================================
-- 1. Allow the new plan type on profiles + promo codes
-- ============================================================
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_subscription_type_check
  CHECK (subscription_type IN ('monthly', 'quarterly', 'biennial', 'annual', 'b2b_quarterly', 'b2b_annual'));

ALTER TABLE public.promo_codes DROP CONSTRAINT IF EXISTS promo_codes_plan_type_check;
ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_plan_type_check
  CHECK (plan_type IN ('monthly', 'quarterly', 'biennial', 'annual', 'b2b_quarterly', 'b2b_annual'));

-- ============================================================
-- 2. Subscription expiry helper understands the new plan type
-- ============================================================
CREATE OR REPLACE FUNCTION public.subscription_expiry_for_plan(p_plan_type TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_plan_type
    WHEN 'monthly'        THEN now() + INTERVAL '30 days'
    WHEN 'quarterly'      THEN now() + INTERVAL '90 days'
    WHEN 'biennial'       THEN now() + INTERVAL '180 days'
    WHEN 'annual'         THEN now() + INTERVAL '365 days'
    WHEN 'b2b_quarterly'  THEN now() + INTERVAL '90 days'
    WHEN 'b2b_annual'     THEN now() + INTERVAL '365 days'
    ELSE now() + INTERVAL '30 days'
  END;
$$;

REVOKE ALL ON FUNCTION public.subscription_expiry_for_plan(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_expiry_for_plan(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_expiry_for_plan(TEXT) TO anon;

-- ============================================================
-- 3. Manual deposit narration mapping: detect B2B quarterly before
--    the generic '%quarterly%' / '%b2b%' branches.
-- ============================================================
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
            WHEN deposit_record.narration LIKE '%b2b_quarterly%'
              OR deposit_record.narration LIKE '%b2b%quarterly%'
              OR deposit_record.narration LIKE '%b2b% 3 months%' THEN 'b2b_quarterly'
            WHEN deposit_record.narration LIKE '%quarterly%' THEN 'quarterly'
            WHEN deposit_record.narration LIKE '%biennial%' OR deposit_record.narration LIKE '%bi-annual%' THEN 'biennial'
            WHEN deposit_record.narration LIKE '%b2b%' THEN 'b2b_annual'
            WHEN deposit_record.narration LIKE '%annual%' THEN 'annual'
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

REVOKE ALL ON FUNCTION public.process_deposit_request(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_deposit_request(UUID, UUID, TEXT) TO authenticated;