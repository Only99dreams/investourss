-- ============================================================
-- Competition management: category-scoped open/close
-- ============================================================
--
-- A "stage" is a competition, and every competition belongs to exactly one
-- category. Several categories can each have a competition running at the
-- same time, so opening one category's competition must never touch another
-- category's.
--
-- set_voting_stage() (20261002000000) can do the opening, but it also accepts
-- a NULL category, in which case it closes EVERY current stage. That is the
-- old single-global competition behaviour and is exactly what we do not want
-- from the admin UI, so these two purpose-built RPCs are added:
--
--   open_competition(name, category, ...)  -> requires a category, closes only
--                                             that category's current stage
--   close_competition(stage_id)            -> ends one competition precisely
--
-- Both are admin-only. Idempotent and safe to re-run.

-- ------------------------------------------------------------------
-- 1. Open a competition for one category
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_competition(
  p_name TEXT,
  p_category TEXT,
  p_opens_at TIMESTAMPTZ DEFAULT NULL,
  p_closes_at TIMESTAMPTZ DEFAULT NULL,
  p_stage_number INTEGER DEFAULT NULL
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
    RAISE EXCEPTION 'not authorised to open a competition'
      USING ERRCODE = '42501';
  END IF;

  IF p_category IS NULL OR btrim(p_category) = '' THEN
    RAISE EXCEPTION 'a competition must belong to a category';
  END IF;

  -- Stage numbers are per category, so each competition's stages read 1, 2, 3
  -- independently of other categories. The admin can pick the stage number
  -- explicitly; otherwise it continues the category's sequence.
  SELECT COALESCE(MAX(stage_number), 0) + 1 INTO v_number
  FROM public.voting_stages
  WHERE category = p_category;

  IF p_stage_number IS NOT NULL THEN
    IF p_stage_number < 1 THEN
      RAISE EXCEPTION 'stage number must be 1 or greater';
    END IF;
    v_number := p_stage_number;
  END IF;

  -- Only this category's current competition is superseded; other categories
  -- keep running.
  UPDATE public.voting_stages
  SET is_current = FALSE
  WHERE is_current AND category = p_category;

  INSERT INTO public.voting_stages (name, category, stage_number, is_current, opens_at, closes_at)
  VALUES (p_name, p_category, v_number, TRUE, p_opens_at, p_closes_at)
  RETURNING id INTO v_id;

  -- A new stage starts a fresh scoreboard: votes cast under the old stage
  -- stay tied to that stage, but the live counters for this category's posts
  -- reset to zero. Other categories are untouched.
  UPDATE public.posts p
  SET votes_count = COALESCE((
        SELECT sum(pv.amount)::INTEGER
        FROM public.post_votes pv
        JOIN public.get_current_voting_stage(p.category) s ON s.stage_id = pv.stage_id
        WHERE pv.post_id = p.id
      ), 0)
  WHERE p.category = p_category;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_competition(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_competition(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 2. Close one competition by id
-- ------------------------------------------------------------------
-- Closing by stage id rather than by category means the admin ends exactly
-- the competition they clicked, even if the category has advanced since.
CREATE OR REPLACE FUNCTION public.close_competition(p_stage_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found BOOLEAN := FALSE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorised to close a competition'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.voting_stages
  SET is_current = FALSE
  WHERE id = p_stage_id AND is_current
  RETURNING TRUE INTO v_found;

  IF v_found THEN
    -- A closed competition's votes disappear: its posts' counters reset and
    -- the records themselves are removed, so nothing from it is voteable or
    -- ranked any longer.
    WITH removed AS (
      DELETE FROM public.post_votes
      WHERE stage_id = p_stage_id
      RETURNING post_id
    )
    UPDATE public.posts p
    SET votes_count = COALESCE((
          SELECT sum(pv.amount)::INTEGER
          FROM public.post_votes pv
          JOIN public.get_current_voting_stage(p.category) s ON s.stage_id = pv.stage_id
          WHERE pv.post_id = p.id
        ), 0)
    WHERE p.id IN (SELECT post_id FROM removed);
  END IF;

  RETURN COALESCE(v_found, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.close_competition(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_competition(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 3. Edit one competition's details
-- ------------------------------------------------------------------
-- The voting_stages table is read-only for clients (RLS), so admins go
-- through this RPC to rename a competition, move it to a different
-- category, or adjust its open/close window. Every field is optional:
-- pass NULL to keep what is already stored. The stage_number is left
-- alone so the per-category numbering stays dense.
CREATE OR REPLACE FUNCTION public.update_competition(
  p_stage_id UUID,
  p_name TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_opens_at TIMESTAMPTZ DEFAULT NULL,
  p_closes_at TIMESTAMPTZ DEFAULT NULL,
  p_stage_number INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_found BOOLEAN := FALSE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorised to edit a competition'
      USING ERRCODE = '42501';
  END IF;

  IF p_category IS NOT NULL AND btrim(p_category) = '' THEN
    RAISE EXCEPTION 'a competition must belong to a category';
  END IF;

  IF p_stage_number IS NOT NULL AND p_stage_number < 1 THEN
    RAISE EXCEPTION 'stage number must be 1 or greater';
  END IF;

  UPDATE public.voting_stages
  SET
    name = COALESCE(NULLIF(btrim(p_name), ''), name),
    category = COALESCE(NULLIF(btrim(p_category), ''), category),
    opens_at = COALESCE(p_opens_at, opens_at),
    closes_at = COALESCE(p_closes_at, closes_at),
    stage_number = COALESCE(p_stage_number, stage_number)
  WHERE id = p_stage_id
  RETURNING TRUE INTO v_found;

  RETURN COALESCE(v_found, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.update_competition(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_competition(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 4. Keep the leaderboard visible for every running competition
-- ------------------------------------------------------------------
-- get_voted_categories only listed categories that had at least one vote.
-- Right after a new stage opens the scoreboard is zero, so it returned
-- nothing and hid the leaderboard entirely. Include every category with a
-- currently open competition, even at zero votes.
CREATE OR REPLACE FUNCTION public.get_voted_categories()
RETURNS TABLE (category TEXT, total_votes INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH voted AS (
    SELECT p.category, sum(pv.amount)::INTEGER AS total
    FROM public.post_votes pv
    JOIN public.posts p ON p.id = pv.post_id
    JOIN public.get_current_voting_stage(p.category) s ON s.stage_id = pv.stage_id
    WHERE p.is_approved AND NOT p.is_hidden
    GROUP BY p.category
  ),
  open_cats AS (
    SELECT DISTINCT category
    FROM public.voting_stages
    WHERE is_current AND category IS NOT NULL
  )
  SELECT o.category, COALESCE(v.total, 0)::INTEGER
  FROM open_cats o
  LEFT JOIN voted v ON v.category = o.category
  ORDER BY COALESCE(v.total, 0) DESC, o.category;
$$;

REVOKE ALL ON FUNCTION public.get_voted_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_voted_categories() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_voted_categories() TO anon;
