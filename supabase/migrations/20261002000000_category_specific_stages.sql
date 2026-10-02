-- ============================================================
-- Category-specific voting stages + Closed Votes History
-- ============================================================
--
-- Stages are now category-specific, meaning each competition category
-- can have its own voting stage. This also creates a "Closed Votes
-- History" for every stage that has ended.
--
-- This migration is idempotent and safe to re-run.

-- ------------------------------------------------------------------
-- 1. Add category column to voting_stages
-- ------------------------------------------------------------------
ALTER TABLE public.voting_stages ADD COLUMN IF NOT EXISTS category TEXT;

-- Create index for faster category-based queries
CREATE INDEX IF NOT EXISTS idx_voting_stages_category ON public.voting_stages (category);
CREATE INDEX IF NOT EXISTS idx_voting_stages_category_current ON public.voting_stages (category, is_current);

-- ------------------------------------------------------------------
-- 2. Update set_voting_stage to accept category
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_voting_stage(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.set_voting_stage(
  p_name TEXT,
  p_category TEXT DEFAULT NULL,
  p_stage_number INTEGER DEFAULT NULL,
  p_opens_at TIMESTAMPTZ DEFAULT NULL,
  p_closes_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_number INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorised to change the voting stage'
      USING ERRCODE = '42501';
  END IF;

  -- When a category is specified, only close stages for that category.
  -- When no category is specified, close all current stages (legacy behavior).
  IF p_category IS NOT NULL THEN
    SELECT COALESCE(MAX(stage_number), 0) + 1 INTO v_number
    FROM public.voting_stages
    WHERE category = p_category;

    UPDATE public.voting_stages SET is_current = FALSE
    WHERE is_current AND category = p_category;
  ELSE
    SELECT COALESCE(MAX(stage_number), 0) + 1 INTO v_number
    FROM public.voting_stages;

    UPDATE public.voting_stages SET is_current = FALSE WHERE is_current;
  END IF;

  INSERT INTO public.voting_stages (name, category, stage_number, is_current, opens_at, closes_at)
  VALUES (p_name, p_category, COALESCE(p_stage_number, v_number), TRUE, p_opens_at, p_closes_at)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_voting_stage(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_voting_stage(TEXT, TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 3. Update get_current_voting_stage to support category filtering
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_current_voting_stage();

CREATE OR REPLACE FUNCTION public.get_current_voting_stage(p_category TEXT DEFAULT NULL)
RETURNS TABLE (
  stage_id UUID,
  stage_name TEXT,
  stage_number INTEGER,
  stage_category TEXT,
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.name, s.stage_number, s.category, s.opens_at, s.closes_at
  FROM public.voting_stages s
  WHERE s.is_current
    AND (s.opens_at IS NULL OR s.opens_at <= now())
    AND (s.closes_at IS NULL OR s.closes_at > now())
    AND (p_category IS NULL OR s.category = p_category OR s.category IS NULL)
  ORDER BY s.category NULLS LAST, s.stage_number DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_voting_stage(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_voting_stage(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_voting_stage(TEXT) TO anon;

-- ------------------------------------------------------------------
-- 4. Create function to get closed stages (Closed Votes History)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_closed_stages(p_category TEXT DEFAULT NULL)
RETURNS TABLE (
  stage_id UUID,
  stage_name TEXT,
  stage_number INTEGER,
  stage_category TEXT,
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  total_votes INTEGER,
  total_posts_voted INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.name,
    s.stage_number,
    s.category,
    s.opens_at,
    s.closes_at,
    COALESCE((SELECT sum(pv.amount)::INTEGER FROM public.post_votes pv WHERE pv.stage_id = s.id), 0),
    COALESCE((SELECT COUNT(DISTINCT pv.post_id)::INTEGER FROM public.post_votes pv WHERE pv.stage_id = s.id), 0)
  FROM public.voting_stages s
  WHERE NOT s.is_current
    AND (p_category IS NULL OR s.category = p_category OR s.category IS NULL)
  ORDER BY s.stage_number DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.get_closed_stages(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_closed_stages(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_closed_stages(TEXT) TO anon;

-- ------------------------------------------------------------------
-- 5. Update get_voting_power to support category-specific stages
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_voting_power(UUID);

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

  -- Is the subscription live?
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
    v_sub_type := COALESCE(
      CASE WHEN v_sub_type = 'b2b_annual' THEN 'annual' ELSE v_sub_type END,
      'monthly'
    );

    SELECT t.votes_per_stage, t.label INTO v_per_stage, v_label
    FROM public.voting_power_tiers t
    WHERE t.source = 'subscription' AND t.plan_key = v_sub_type;
  ELSE
    -- Credit packs
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

  SELECT COALESCE(sum(pv.amount), 0)::INTEGER INTO v_used
  FROM public.post_votes pv
  WHERE pv.user_id = v_uid AND pv.stage_id = v_stage.stage_id;

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
-- 6. Update cast_post_vote to support category-specific stages
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cast_post_vote(UUID, INTEGER);

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
             'You have ' || v_power.votes_remaining || ' vote(s) left for this stage.',
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

  SELECT COALESCE(sum(pv.amount), 0)::INTEGER INTO v_remaining
  FROM public.post_votes pv
  WHERE pv.user_id = v_uid AND pv.stage_id = v_power.stage_id;

  RETURN QUERY
    SELECT TRUE,
           'Vote recorded.',
           GREATEST(v_power.votes_per_stage - v_remaining, 0),
           v_post_total;
END;
$$;

REVOKE ALL ON FUNCTION public.cast_post_vote(UUID, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_post_vote(UUID, INTEGER, TEXT) TO authenticated;

-- ------------------------------------------------------------------
-- 7. Update get_my_votes to support category filtering
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_my_votes(UUID[]);

CREATE OR REPLACE FUNCTION public.get_my_votes(p_post_ids UUID[], p_category TEXT DEFAULT NULL)
RETURNS TABLE (post_id UUID, amount INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pv.post_id, sum(pv.amount)::INTEGER
  FROM public.post_votes pv
  JOIN public.get_current_voting_stage(p_category) s ON s.stage_id = pv.stage_id
  WHERE pv.user_id = auth.uid() AND pv.post_id = ANY (p_post_ids)
  GROUP BY pv.post_id;
$$;

REVOKE ALL ON FUNCTION public.get_my_votes(UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_votes(UUID[], TEXT) TO authenticated;

-- ------------------------------------------------------------------
-- 8. Update leaderboard functions to support category-specific stages
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_category_leaderboard(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.get_category_leaderboard(
  p_category TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  rank INTEGER,
  user_id UUID,
  full_name TEXT,
  avatar_url TEXT,
  total_votes INTEGER,
  posts_count INTEGER,
  top_post_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH scoped AS (
    SELECT p.author_id, pv.amount, p.id AS post_id
    FROM public.post_votes pv
    JOIN public.posts p ON p.id = pv.post_id
    JOIN public.get_current_voting_stage(p_category) s ON s.stage_id = pv.stage_id
    WHERE p.is_approved AND NOT p.is_hidden
      AND (p_category IS NULL OR p_category = '' OR p.category IS NULL OR p.category = p_category)
  ),
  per_post AS (
    SELECT scoped.author_id, scoped.post_id, sum(scoped.amount)::INTEGER AS votes
    FROM scoped
    WHERE scoped.author_id IS NOT NULL
    GROUP BY scoped.author_id, scoped.post_id
  )
  SELECT
    (row_number() OVER (ORDER BY sum(per_post.votes) DESC, per_post.author_id))::INTEGER,
    per_post.author_id,
    COALESCE(pr.full_name, 'Member'),
    pr.avatar_url,
    sum(per_post.votes)::INTEGER,
    count(*)::INTEGER,
    (array_agg(per_post.post_id ORDER BY per_post.votes DESC, per_post.post_id))[1]
  FROM per_post
  LEFT JOIN public.profiles pr ON pr.id = per_post.author_id
  GROUP BY per_post.author_id, pr.full_name, pr.avatar_url
  ORDER BY sum(per_post.votes) DESC, per_post.author_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.get_category_leaderboard(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_category_leaderboard(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_leaderboard(TEXT, INTEGER) TO anon;

-- ------------------------------------------------------------------
-- 9. Update get_voted_categories to support category-specific stages
-- ------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_voted_categories();

CREATE OR REPLACE FUNCTION public.get_voted_categories()
RETURNS TABLE (category TEXT, total_votes INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.category, sum(pv.amount)::INTEGER
  FROM public.post_votes pv
  JOIN public.posts p ON p.id = pv.post_id
  JOIN public.get_current_voting_stage(p.category) s ON s.stage_id = pv.stage_id
  WHERE p.is_approved AND NOT p.is_hidden
  GROUP BY p.category
  ORDER BY sum(pv.amount) DESC, p.category;
$$;

REVOKE ALL ON FUNCTION public.get_voted_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_voted_categories() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_voted_categories() TO anon;

-- ------------------------------------------------------------------
-- 10. Backfill: set category on existing stages based on posts
-- ------------------------------------------------------------------
-- Existing stages without a category will continue to work as global stages
-- (category IS NULL means "applies to all categories")

-- ------------------------------------------------------------------
-- 11. Add realtime publication for voting_stages if not exists
-- ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'voting_stages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voting_stages;
  END IF;
END;
$$;
