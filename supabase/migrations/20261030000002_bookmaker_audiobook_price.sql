-- ============================================================
-- Bookmaker — audiobook narration costs 2 credits
-- ============================================================
-- Narration is still priced flat for the whole book and the reservation can
-- still be stopped early, with unused chapters refunded.

CREATE OR REPLACE FUNCTION public.bookmaker_operation_cost(
  p_operation TEXT,
  p_length TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_length TEXT := COALESCE(p_length, 'short');
BEGIN
  IF p_operation IN ('initial_book', 'full_regeneration') THEN
    RETURN CASE v_length
      WHEN 'short' THEN 2
      WHEN 'medium' THEN 4
      WHEN 'long' THEN 6
      ELSE 2
    END;
  ELSIF p_operation = 'audiobook' THEN
    RETURN 2;
  ELSIF p_operation IN ('chapter_regeneration', 'visual_regeneration', 'cover_generation') THEN
    RETURN 1;
  ELSIF p_operation IN ('outline', 'export') THEN
    RETURN 0;
  END IF;
  RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_operation_cost(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_operation_cost(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookmaker_operation_cost(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.bookmaker_get_entitlement()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_grant public.bookmaker_subscription_credits;
  v_sub_remaining INTEGER := 0;
  v_pack_total INTEGER := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', FALSE,
      'subscription_active', FALSE,
      'subscription_credits_remaining', 0,
      'pack_credits_remaining', 0,
      'total_available', 0
    );
  END IF;

  v_grant := public.bookmaker_ensure_subscription_grant(v_user);

  IF v_grant.id IS NOT NULL THEN
    v_sub_remaining := GREATEST(v_grant.credits_granted - v_grant.credits_used, 0);
  END IF;

  SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER INTO v_pack_total
  FROM public.user_credit_packs
  WHERE user_id = v_user
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  RETURN jsonb_build_object(
    'authenticated', TRUE,
    'subscription_active', v_grant.id IS NOT NULL,
    'subscription_type', v_grant.subscription_type,
    'subscription_credits_remaining', v_sub_remaining,
    'subscription_credits_granted', COALESCE(v_grant.credits_granted, 0),
    'subscription_credits_used', COALESCE(v_grant.credits_used, 0),
    'subscription_period_end', v_grant.period_end,
    'pack_credits_remaining', v_pack_total,
    'total_available', v_sub_remaining + v_pack_total,
    'costs', jsonb_build_object(
      'short', 2,
      'medium', 4,
      'long', 6,
      'chapter_regeneration', 1,
      'visual_regeneration', 1,
      'cover_generation', 1,
      'audiobook', 2,
      'full_regeneration_short', 2,
      'full_regeneration_medium', 4,
      'full_regeneration_long', 6
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_get_entitlement() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_get_entitlement() TO authenticated;
