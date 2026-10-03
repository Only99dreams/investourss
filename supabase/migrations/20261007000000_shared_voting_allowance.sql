-- ============================================================
-- Shared voting allowance across every open competition
-- ============================================================
--
-- A member's voting power is one pool. Previously get_voting_power
-- counted votes used inside that post's stage only, so each category's
-- stage silently granted a FRESH allowance: a member could spend their
-- full allowance in one category and vote again, with the same power,
-- in another.
--
-- After this migration a member's used votes are counted across ALL of
-- their current competitions (any category, including the legacy
-- category-less stage). Once the pool is spent they cannot vote in any
-- other category's competition until the next stage opens or they
-- upgrade to a higher tier.
--
-- Idempotent and safe to re-run.

-- ------------------------------------------------------------------
-- 1. get_voting_power: used votes span every open stage
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_voting_power(p_user_id UUID DEFAULT NULL, p_category TEXT DEFAULT NULL)
RETURNS TABLE (
  stage_id UUID,
  stage_name TEXT,
  stage_number INTEGER,
  stage_category TEXT,
  source TEXT,
  source_label TEXT,
  votes_per_stage INTEGER,
  votes_used INTEGER,
  votes_remaining INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_stage RECORD;
  v_source TEXT := NULL;
  v_label TEXT := NULL;
  v_per_stage INTEGER := 0;
  v_sub_ok BOOLEAN := FALSE;
  v_sub_type TEXT;
  v_used INTEGER := 0;
  v_best INTEGER := 0;
  v_best_label TEXT;
  r RECORD;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;

  SELECT * INTO v_stage FROM public.get_current_voting_stage(p_category);
  IF v_stage.stage_id IS NULL THEN
    RETURN; -- no open stage: voting is closed
  END IF;

  SELECT
    ((COALESCE(p.has_active_subscription, FALSE)
       AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now()))
     OR (p.subscription_expires_at IS NOT NULL AND p.subscription_expires_at > now())
     OR COALESCE(p.user_tier, 'free') IN ('premium', 'exclusive')),
    NULLIF(p.subscription_type, '')
  INTO v_sub_ok, v_sub_type
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_sub_ok THEN
    v_source := 'subscription';
    v_sub_type := COALESCE(NULLIF(v_sub_type, ''), 'monthly');

    SELECT t.votes_per_stage, t.label INTO v_per_stage, v_label
    FROM public.voting_power_tiers t
    WHERE t.source = 'subscription' AND t.plan_key = v_sub_type;

    IF v_per_stage IS NULL OR v_per_stage <= 0 THEN
      SELECT t.votes_per_stage, t.label INTO v_per_stage, v_label
      FROM public.voting_power_tiers t
      WHERE t.source = 'subscription' AND t.plan_key = 'monthly';
    END IF;
  ELSE
    FOR r IN
      SELECT DISTINCT ucp.pack_name
      FROM public.user_credit_packs ucp
      WHERE ucp.user_id = v_uid
        AND ucp.status = 'active'
        AND ucp.credits_remaining > 0
        AND (ucp.expires_at IS NULL OR ucp.expires_at > now())
    LOOP
      v_best := 0;
      SELECT t.votes_per_stage, t.label INTO v_best, v_best_label
      FROM public.voting_power_tiers t
      WHERE t.source = 'credit_pack'
        AND lower(r.pack_name) LIKE '%' || t.plan_key || '%'
      ORDER BY t.votes_per_stage DESC
      LIMIT 1;

      IF v_best > v_per_stage THEN
        v_per_stage := v_best;
        v_label := v_best_label;
      END IF;
    END LOOP;

    IF v_per_stage > 0 THEN
      v_source := 'credit_pack';
    END IF;
  END IF;

  IF v_per_stage <= 0 THEN
    RETURN; -- not a paid user
  END IF;

  -- The shared allowance: count every vote this member has cast in any
  -- currently open competition, regardless of its category.
  SELECT COALESCE(sum(pv.amount), 0)::INTEGER INTO v_used
  FROM public.post_votes pv
  JOIN public.voting_stages s ON s.id = pv.stage_id
  WHERE pv.user_id = v_uid AND s.is_current;

  stage_id := v_stage.stage_id;
  stage_name := v_stage.stage_name;
  stage_number := v_stage.stage_number;
  stage_category := v_stage.stage_category;
  source := v_source;
  source_label := v_label;
  votes_per_stage := v_per_stage;
  votes_used := v_used;
  votes_remaining := GREATEST(v_per_stage - v_used, 0);

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_voting_power(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_voting_power(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_voting_power(UUID, TEXT) TO anon;

-- ------------------------------------------------------------------
-- 2. cast_post_vote: check against and report the SHARED allowance
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cast_post_vote(
  p_post_id UUID,
  p_amount INTEGER,
  p_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  ok BOOLEAN,
  message TEXT,
  votes_remaining INTEGER,
  post_votes_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_power RECORD;
  v_post RECORD;
  v_existing INTEGER;
  v_post_total INTEGER;
  v_remaining INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Sign in to vote.', 0, 0;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN QUERY SELECT FALSE, 'A vote cannot be withdrawn once cast.', 0, 0;
    RETURN;
  END IF;

  SELECT * INTO v_post
  FROM public.posts p
  WHERE p.id = p_post_id;

  IF NOT FOUND OR v_post.is_hidden OR NOT v_post.is_approved THEN
    RETURN QUERY SELECT FALSE, 'That post is not available.', 0, 0;
    RETURN;
  END IF;

  IF v_post.author_id = v_uid THEN
    RETURN QUERY SELECT FALSE, 'You cannot vote for your own post.', 0, 0;
    RETURN;
  END IF;

  -- Use category from the post if not explicitly provided
  SELECT * INTO v_power FROM public.get_voting_power(v_uid, COALESCE(p_category, v_post.category));
  IF v_power.stage_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Voting is closed right now.', 0, 0;
    RETURN;
  END IF;

  SELECT pv.amount INTO v_existing
  FROM public.post_votes pv
  WHERE pv.post_id = p_post_id
    AND pv.user_id = v_uid
    AND pv.stage_id = v_power.stage_id;

  IF p_amount < COALESCE(v_existing, 0) THEN
    RETURN QUERY
      SELECT FALSE,
             'A vote cannot be reduced once cast.',
             v_power.votes_remaining, COALESCE(v_post.votes_count, 0);
    RETURN;
  END IF;

  IF p_amount - COALESCE(v_existing, 0) > v_power.votes_remaining THEN
    RETURN QUERY
      SELECT FALSE,
             'You have ' || v_power.votes_remaining || ' vote(s) left across your current competitions.',
             v_power.votes_remaining, COALESCE(v_post.votes_count, 0);
    RETURN;
  END IF;

  INSERT INTO public.post_votes (post_id, user_id, stage_id, amount)
  VALUES (p_post_id, v_uid, v_power.stage_id, p_amount)
  ON CONFLICT (post_id, user_id, stage_id) DO UPDATE
    SET amount = EXCLUDED.amount, updated_at = now();

  SELECT COALESCE(sum(pv.amount), 0)::INTEGER INTO v_post_total
  FROM public.post_votes pv
  JOIN public.get_current_voting_stage(COALESCE(p_category, v_post.category)) s ON s.stage_id = pv.stage_id
  WHERE pv.post_id = p_post_id;

  -- Shared allowance: every current vote this member has cast counts,
  -- so spending it here also exhausts it in every other category.
  SELECT COALESCE(sum(pv.amount), 0)::INTEGER INTO v_remaining
  FROM public.post_votes pv
  JOIN public.voting_stages s ON s.id = pv.stage_id
  WHERE pv.user_id = v_uid AND s.is_current;

  RETURN QUERY
    SELECT TRUE,
           'Vote recorded.',
           GREATEST(v_power.votes_per_stage - v_remaining, 0),
           v_post_total;
END;
$$;

REVOKE ALL ON FUNCTION public.cast_post_vote(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_post_vote(UUID, INTEGER, TEXT) TO authenticated;
