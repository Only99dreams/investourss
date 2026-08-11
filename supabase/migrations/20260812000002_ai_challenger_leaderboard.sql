-- AI Challenger Leaderboard
--
-- The leaderboard is graded on the combination of:
--   * the user's LATEST AI Business Plan funding readiness score (0-100) — heavier weight
--   * XP earned from the AI Tutor — lighter weight
--   composite_score = funding_readiness_score * 10 + round(xp_total / 10)
--
-- Challenges are seasonal. Admin can "clear" the leaderboard to start a new
-- challenge: current standings are archived to challenge_leaderboard_archive
-- (users' previous scores remain available, e.g. on their personal dashboard)
-- and a brand new, empty season starts. Users' underlying XP and business plan
-- scores are never deleted.

-- ============================================================
-- 1. Ensure business_plans has the funding readiness score column
-- ============================================================
ALTER TABLE public.business_plans
  ADD COLUMN IF NOT EXISTS funding_readiness_score INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 2. Challenge seasons (one active at a time)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.challenge_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- ============================================================
-- 3. Live standings for the current challenge
-- ============================================================
CREATE TABLE IF NOT EXISTS public.challenge_leaderboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.challenge_seasons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  funding_readiness_score INTEGER NOT NULL DEFAULT 0,
  xp_total INTEGER NOT NULL DEFAULT 0,
  composite_score INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(season_id, user_id)
);

-- ============================================================
-- 4. Archived standings from finished challenges
-- ============================================================
CREATE TABLE IF NOT EXISTS public.challenge_leaderboard_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.challenge_seasons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  full_name TEXT,
  funding_readiness_score INTEGER NOT NULL DEFAULT 0,
  xp_total INTEGER NOT NULL DEFAULT 0,
  composite_score INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the first active challenge
INSERT INTO public.challenge_seasons (name, started_at, is_active)
SELECT 'Challenge 1', now(), true
WHERE NOT EXISTS (SELECT 1 FROM public.challenge_seasons WHERE is_active = true);

-- ============================================================
-- 5. Helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_active_challenge_season()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.challenge_seasons WHERE is_active = true ORDER BY started_at DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.compute_challenge_composite(p_funding INTEGER, p_xp INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (COALESCE(p_funding, 0) * 10 + ROUND(COALESCE(p_xp, 0) / 10.0))::INTEGER;
$$;

-- Keep a user's live entry in sync with their latest plan score + tutor XP
CREATE OR REPLACE FUNCTION public.sync_challenge_leaderboard_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season UUID;
  v_funding INTEGER;
  v_xp INTEGER;
BEGIN
  v_season := public.get_active_challenge_season();
  IF v_season IS NULL THEN
    RETURN;
  END IF;

  SELECT bp.funding_readiness_score INTO v_funding
  FROM public.business_plans bp
  WHERE bp.user_id = p_user_id
    AND bp.funding_readiness_score IS NOT NULL
  ORDER BY bp.updated_at DESC, bp.created_at DESC
  LIMIT 1;

  SELECT COALESCE(tul.xp_total, 0) INTO v_xp
  FROM public.tutor_user_levels tul
  WHERE tul.user_id = p_user_id;

  IF COALESCE(v_funding, 0) = 0 AND COALESCE(v_xp, 0) = 0 THEN
    DELETE FROM public.challenge_leaderboard WHERE season_id = v_season AND user_id = p_user_id;
    RETURN;
  END IF;

  INSERT INTO public.challenge_leaderboard (season_id, user_id, funding_readiness_score, xp_total, composite_score, updated_at)
  VALUES (v_season, p_user_id, COALESCE(v_funding, 0), COALESCE(v_xp, 0),
          public.compute_challenge_composite(v_funding, v_xp), now())
  ON CONFLICT (season_id, user_id)
  DO UPDATE SET
    funding_readiness_score = EXCLUDED.funding_readiness_score,
    xp_total = EXCLUDED.xp_total,
    composite_score = EXCLUDED.composite_score,
    updated_at = now();
END;
$$;

-- ============================================================
-- 6. Triggers to keep the leaderboard live
-- ============================================================
CREATE OR REPLACE FUNCTION public.trigger_sync_tutor_leaderboard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_challenge_leaderboard_user(COALESCE(NEW.user_id, OLD.user_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tutor_leaderboard_sync ON public.tutor_user_levels;
CREATE TRIGGER trg_tutor_leaderboard_sync
  AFTER INSERT OR UPDATE ON public.tutor_user_levels
  FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_tutor_leaderboard();

CREATE OR REPLACE FUNCTION public.trigger_sync_plan_leaderboard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_challenge_leaderboard_user(COALESCE(NEW.user_id, OLD.user_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plan_leaderboard_sync ON public.business_plans;
CREATE TRIGGER trg_plan_leaderboard_sync
  AFTER INSERT OR UPDATE ON public.business_plans
  FOR EACH ROW EXECUTE FUNCTION public.trigger_sync_plan_leaderboard();

-- ============================================================
-- 7. Backfill existing users into the active challenge
-- ============================================================
INSERT INTO public.challenge_leaderboard (season_id, user_id, funding_readiness_score, xp_total, composite_score, updated_at)
SELECT s.id, tul.user_id,
       COALESCE(pl.latest_score, 0),
       COALESCE(tul.xp_total, 0),
       public.compute_challenge_composite(COALESCE(pl.latest_score, 0), COALESCE(tul.xp_total, 0)),
       now()
FROM public.tutor_user_levels tul
CROSS JOIN (SELECT id FROM public.challenge_seasons WHERE is_active = true ORDER BY started_at DESC LIMIT 1) s
LEFT JOIN LATERAL (
  SELECT bp.funding_readiness_score AS latest_score
  FROM public.business_plans bp
  WHERE bp.user_id = tul.user_id AND bp.funding_readiness_score IS NOT NULL
  ORDER BY bp.updated_at DESC, bp.created_at DESC
  LIMIT 1
) pl ON true
ON CONFLICT (season_id, user_id) DO NOTHING;

INSERT INTO public.challenge_leaderboard (season_id, user_id, funding_readiness_score, xp_total, composite_score, updated_at)
SELECT s.id, pl.user_id, pl.latest_score, 0,
       public.compute_challenge_composite(pl.latest_score, 0),
       now()
FROM (
  SELECT DISTINCT ON (bp.user_id) bp.user_id, bp.funding_readiness_score AS latest_score
  FROM public.business_plans bp
  WHERE bp.funding_readiness_score IS NOT NULL
  ORDER BY bp.user_id, bp.updated_at DESC, bp.created_at DESC
) pl
CROSS JOIN (SELECT id FROM public.challenge_seasons WHERE is_active = true ORDER BY started_at DESC LIMIT 1) s
WHERE NOT EXISTS (SELECT 1 FROM public.tutor_user_levels tul WHERE tul.user_id = pl.user_id)
ON CONFLICT (season_id, user_id) DO NOTHING;

-- ============================================================
-- 8. Leaderboard RPC (reads the active challenge's standings)
-- ============================================================
-- The old function returns a different row shape; DROP is required before
-- changing the OUT-parameter return type.
DROP FUNCTION IF EXISTS public.get_tutor_leaderboard();
CREATE OR REPLACE FUNCTION public.get_tutor_leaderboard()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  xp_total integer,
  level text,
  streak_days integer,
  badges jsonb,
  funding_readiness_score integer,
  composite_score integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cl.user_id,
    p.full_name,
    p.email,
    cl.xp_total,
    tul.level,
    COALESCE(tul.streak_days, 0) AS streak_days,
    tul.badges,
    cl.funding_readiness_score,
    cl.composite_score
  FROM public.challenge_leaderboard AS cl
  JOIN public.challenge_seasons AS cs ON cs.id = cl.season_id AND cs.is_active = true
  LEFT JOIN public.tutor_user_levels AS tul ON tul.user_id = cl.user_id
  JOIN public.profiles AS p ON p.id = cl.user_id
  ORDER BY cl.composite_score DESC, cl.funding_readiness_score DESC, cl.xp_total DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_tutor_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tutor_leaderboard() TO anon;
GRANT EXECUTE ON FUNCTION public.get_tutor_leaderboard() TO authenticated;

-- ============================================================
-- 9. RPC: a user's results from previous challenges
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_challenge_history(p_user_id UUID)
RETURNS TABLE (
  season_id uuid,
  season_name text,
  ended_at timestamptz,
  rank integer,
  funding_readiness_score integer,
  xp_total integer,
  composite_score integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.season_id, cs.name AS season_name, cs.ended_at, a.rank,
         a.funding_readiness_score, a.xp_total, a.composite_score
  FROM public.challenge_leaderboard_archive a
  JOIN public.challenge_seasons cs ON cs.id = a.season_id
  WHERE a.user_id = p_user_id
  ORDER BY cs.ended_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_challenge_history(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_challenge_history(UUID) TO authenticated;

-- ============================================================
-- 10. RPC: admin clears the leaderboard for a new challenge
--     (archives current standings; users' underlying data is preserved)
-- ============================================================
CREATE OR REPLACE FUNCTION public.clear_leaderboard(p_admin_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_season UUID;
  v_new_season UUID;
  v_season_number INTEGER;
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  SELECT id INTO v_old_season
  FROM public.challenge_seasons
  WHERE is_active = true
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_old_season IS NOT NULL THEN
    INSERT INTO public.challenge_leaderboard_archive (season_id, user_id, full_name, funding_readiness_score, xp_total, composite_score, rank, archived_at)
    SELECT cl.season_id, cl.user_id, p.full_name, cl.funding_readiness_score, cl.xp_total, cl.composite_score,
           ROW_NUMBER() OVER (ORDER BY cl.composite_score DESC, cl.funding_readiness_score DESC, cl.xp_total DESC),
           now()
    FROM public.challenge_leaderboard cl
    LEFT JOIN public.profiles p ON p.id = cl.user_id
    WHERE cl.season_id = v_old_season;

    UPDATE public.challenge_seasons
    SET is_active = false, ended_at = now()
    WHERE id = v_old_season;
  END IF;

  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(name, '[^0-9]', '', 'g'), '')::INTEGER), 0) + 1
  INTO v_season_number
  FROM public.challenge_seasons;

  INSERT INTO public.challenge_seasons (name, started_at, is_active)
  VALUES ('Challenge ' || COALESCE(v_season_number, 1), now(), true)
  RETURNING id INTO v_new_season;

  RETURN jsonb_build_object('success', TRUE, 'new_season_id', v_new_season, 'name', 'Challenge ' || COALESCE(v_season_number, 1));
END;
$$;

REVOKE ALL ON FUNCTION public.clear_leaderboard(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_leaderboard(UUID) TO authenticated;

-- ============================================================
-- 11. Row Level Security
-- ============================================================
ALTER TABLE public.challenge_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_leaderboard_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read challenge seasons" ON public.challenge_seasons;
CREATE POLICY "Anyone can read challenge seasons"
  ON public.challenge_seasons FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage challenge seasons" ON public.challenge_seasons;
CREATE POLICY "Admins manage challenge seasons"
  ON public.challenge_seasons FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone can read challenge leaderboard" ON public.challenge_leaderboard;
CREATE POLICY "Anyone can read challenge leaderboard"
  ON public.challenge_leaderboard FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage challenge leaderboard" ON public.challenge_leaderboard;
CREATE POLICY "Admins manage challenge leaderboard"
  ON public.challenge_leaderboard FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone can read challenge archive" ON public.challenge_leaderboard_archive;
CREATE POLICY "Anyone can read challenge archive"
  ON public.challenge_leaderboard_archive FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage challenge archive" ON public.challenge_leaderboard_archive;
CREATE POLICY "Admins manage challenge archive"
  ON public.challenge_leaderboard_archive FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_challenge_leaderboard_season_score
  ON public.challenge_leaderboard (season_id, composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_challenge_archive_user
  ON public.challenge_leaderboard_archive (user_id);
