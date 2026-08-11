-- Unified subscriber access
--
-- Every ACTIVE subscriber gets access to everything: AI Auditor, FHA Chatroom
-- and the Ambassadors programme.
--
-- A subscription counts as ACTIVE when EITHER:
--   * has_active_subscription = TRUE AND (subscription_expires_at IS NULL OR
--     subscription_expires_at > now()), OR
--   * subscription_expires_at IS NOT NULL AND subscription_expires_at > now()
-- (i.e. a real, un-expired subscription grants access even if the boolean flag
--  is stale/missing, and the flag alone does NOT grant access once the expiry
--  date has passed).
--
-- This keeps check_ambassador_eligibility (the FHA Chatroom RLS guard and the
-- ambassador apply/re-check guard) in line with get_audit_access.

-- ============================================================
-- 1. check_ambassador_eligibility: unified active-subscriber rule
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_ambassador_eligibility(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub BOOLEAN;
  v_credits INTEGER;
  v_credit_expires TIMESTAMPTZ;
BEGIN
  SELECT
    ((COALESCE(p.has_active_subscription, FALSE)
       AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now()))
     OR (p.subscription_expires_at IS NOT NULL AND p.subscription_expires_at > now())),
    p.audit_credits,
    p.audit_credits_expires_at
  INTO v_sub, v_credits, v_credit_expires
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_sub THEN
    RETURN TRUE;
  END IF;

  IF COALESCE(v_credits, 0) > 0
     AND v_credit_expires IS NOT NULL
     AND v_credit_expires > now() THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.check_ambassador_eligibility(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_ambassador_eligibility(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_ambassador_eligibility(UUID) TO anon;

-- ============================================================
-- 2. get_audit_access: hardened to the same active-subscriber rule
-- ============================================================
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
