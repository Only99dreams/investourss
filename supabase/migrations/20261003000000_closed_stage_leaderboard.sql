-- ============================================================
-- Admin: closed-stage vote leaderboard
-- ============================================================
--
-- The user-facing "Closed Votes History" is removed from the community
-- page, but admins still need to see the final standings of a stage that
-- has ended. This exposes the same "creators ranked by the votes their
-- posts received" shape as get_category_leaderboard, scoped to one stage
-- id rather than the currently-open stage.
--
-- Admin-only: unlike the live leaderboard (which is public), a closed
-- stage's final results are an internal reporting view.
--
-- Idempotent and safe to re-run.

CREATE OR REPLACE FUNCTION public.get_stage_leaderboard(
  p_stage_id UUID,
  p_limit INTEGER DEFAULT 50
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
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorised to view stage results'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT p.author_id, pv.amount, p.id AS post_id
    FROM public.post_votes pv
    JOIN public.posts p ON p.id = pv.post_id
    WHERE pv.stage_id = p_stage_id
      AND p.is_approved AND NOT p.is_hidden
  ),
  -- Collapse to one row per post so posts_count counts posts, not voters,
  -- and the best post can be picked out below.
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
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.get_stage_leaderboard(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_stage_leaderboard(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stage_leaderboard(UUID, INTEGER) TO service_role;
