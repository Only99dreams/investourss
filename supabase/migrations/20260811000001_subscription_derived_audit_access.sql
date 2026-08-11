-- Harden get_audit_access so a user with an active subscription is NEVER
-- pushed to buy audit credits.
--
-- Previously subscription status came only from the profiles.has_active_subscription
-- boolean. If that flag was FALSE for a real subscriber (stale row, manual edit,
-- or a flow that never set it) the user fell through to the 'credits'/'none'
-- branch and was blocked from the auditor.
--
-- Now a subscription is treated as active when EITHER:
--   * has_active_subscription = TRUE  AND  not expired, OR
--   * subscription_expires_at is still in the future (covers a missing flag).
-- This also correctly revokes access once subscription_expires_at passes,
-- even though the boolean flag is never cleared automatically.

CREATE OR REPLACE FUNCTION public.get_audit_access(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  can_audit BOOLEAN,
  access_type TEXT,
  free_audit_used BOOLEAN,
  subscription_active BOOLEAN,
  credits_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_sub BOOLEAN;
  v_free_used BOOLEAN;
  v_credits INTEGER;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'none', FALSE, FALSE, 0;
    RETURN;
  END IF;

  -- Active if flagged AND not expired, OR expiry is still in the future.
  SELECT (
    (COALESCE(p.has_active_subscription, FALSE) AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now()))
    OR
    (p.subscription_expires_at IS NOT NULL AND p.subscription_expires_at > now())
  ) INTO v_sub
  FROM profiles p
  WHERE p.id = v_user_id;

  SELECT EXISTS (
    SELECT 1 FROM financial_audits WHERE user_id = v_user_id AND is_free = TRUE
  ) INTO v_free_used;

  SELECT COALESCE(SUM(ucp.credits_remaining), 0)::INTEGER INTO v_credits
  FROM user_credit_packs ucp
  WHERE ucp.user_id = v_user_id
    AND ucp.status = 'active'
    AND (ucp.expires_at IS NULL OR ucp.expires_at > now());

  RETURN QUERY
    SELECT (v_sub OR NOT v_free_used OR v_credits > 0) AS can_audit,
           CASE
             WHEN v_sub THEN 'subscription'
             WHEN NOT v_free_used THEN 'free'
             WHEN v_credits > 0 THEN 'credits'
             ELSE 'none'
           END AS access_type,
           v_free_used AS free_audit_used,
           v_sub AS subscription_active,
           v_credits AS credits_remaining;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audit_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_access(UUID) TO authenticated;
