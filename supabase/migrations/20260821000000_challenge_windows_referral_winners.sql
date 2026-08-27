-- ============================================================
-- AI Challenge seasons + Referral Leaderboard as the winner decider
-- ============================================================
-- 1. challenge_seasons gains explicit starts_at / closes_at so admins can set
--    the grading window of the AI Challenge.
-- 2. Referral followers are tracked PER SEASON in
--    referral_challenge_standings: the referral leaderboard for the active
--    season decides the AI Challenge winners. Admin "Start New Challenge"
--    archives AND wipes both leaderboards.
-- 3. sync_challenge_leaderboard_user() is gated on activity inside the season
--    window, so after a wipe the user dashboard leaderboard is NOT repopulated
--    with stale lifetime data from the challenge tables.
-- 4. get_fha_portfolio(p_target_user) lets admins inspect any user's portfolio.
-- 5. apply_referral_code(): reliable SECURITY DEFINER way to link a follower
--    during signup (fixes referrers not updating on dashboards).
-- 6. Backfills the missing 2% indirect commission for historical payments that
--    earned a direct commission before the indirect bonus existed.
-- ============================================================

-- ============================================================
-- 1. Season windows
-- ============================================================
ALTER TABLE public.challenge_seasons
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE public.challenge_seasons
  ADD COLUMN IF NOT EXISTS closes_at TIMESTAMPTZ;

UPDATE public.challenge_seasons SET starts_at = COALESCE(starts_at, started_at);

-- ============================================================
-- 2. Per-season referral standings (decides AI Challenge winners)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.referral_challenge_standings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.challenge_seasons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followers_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(season_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.referral_challenge_standings_archive (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.challenge_seasons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  full_name TEXT,
  followers_count INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.referral_challenge_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_challenge_standings_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read referral standings" ON public.referral_challenge_standings;
CREATE POLICY "Anyone can read referral standings"
  ON public.referral_challenge_standings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage referral standings" ON public.referral_challenge_standings;
CREATE POLICY "Admins manage referral standings"
  ON public.referral_challenge_standings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anyone can read referral standings archive" ON public.referral_challenge_standings_archive;
CREATE POLICY "Anyone can read referral standings archive"
  ON public.referral_challenge_standings_archive FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage referral standings archive" ON public.referral_challenge_standings_archive;
CREATE POLICY "Admins manage referral standings archive"
  ON public.referral_challenge_standings_archive FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_referral_standings_season
  ON public.referral_challenge_standings (season_id, followers_count DESC);

-- Keep a referrer's per-season follower count in sync whenever a profile's
-- referred_by link appears or changes. Standings start empty each season, so
-- only followers gained during the current challenge are counted.
CREATE OR REPLACE FUNCTION public.sync_referral_challenge_standings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season UUID;
  v_old_referrer UUID;
  v_new_referrer UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_referrer := NEW.referred_by;
  ELSE
    IF NEW.referred_by IS NOT DISTINCT FROM OLD.referred_by THEN
      RETURN NULL;
    END IF;
    v_old_referrer := OLD.referred_by;
    v_new_referrer := NEW.referred_by;
  END IF;

  -- Never count self-referrals
  IF v_new_referrer IS NOT NULL AND v_new_referrer = NEW.id THEN
    v_new_referrer := NULL;
  END IF;

  IF v_old_referrer IS NULL AND v_new_referrer IS NULL THEN
    RETURN NULL;
  END IF;

  v_season := public.get_active_challenge_season();
  IF v_season IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_old_referrer IS NOT NULL THEN
    UPDATE public.referral_challenge_standings
    SET followers_count = GREATEST(followers_count - 1, 0), updated_at = now()
    WHERE season_id = v_season AND user_id = v_old_referrer;
  END IF;

  IF v_new_referrer IS NOT NULL THEN
    INSERT INTO public.referral_challenge_standings (season_id, user_id, followers_count)
    VALUES (v_season, v_new_referrer, 1)
    ON CONFLICT (season_id, user_id)
    DO UPDATE SET followers_count = public.referral_challenge_standings.followers_count + 1,
                  updated_at = now();
  END IF;

  -- AFTER trigger: return value is ignored
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_challenge_sync ON public.profiles;
CREATE TRIGGER trg_referral_challenge_sync
  AFTER INSERT OR UPDATE OF referred_by ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_referral_challenge_standings();

-- Seed the current season with followers gained since it started
INSERT INTO public.referral_challenge_standings (season_id, user_id, followers_count)
SELECT s.id, p.referred_by, COUNT(*)::INTEGER
FROM public.profiles p
CROSS JOIN (SELECT id, starts_at FROM public.challenge_seasons WHERE is_active = true ORDER BY started_at DESC LIMIT 1) s
WHERE p.referred_by IS NOT NULL
  AND p.referred_by <> p.id
  AND p.created_at >= s.starts_at
GROUP BY s.id, p.referred_by
ON CONFLICT (season_id, user_id) DO NOTHING;

-- ============================================================
-- 3. RPC: referral leaderboard for the ACTIVE challenge (winner decider)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_referral_challenge_leaderboard()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  referral_count bigint,
  total_earnings numeric,
  rank bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rcs.user_id,
    p.full_name,
    p.email,
    rcs.followers_count::bigint AS referral_count,
    COALESCE(rs.total_earnings, 0)::numeric AS total_earnings,
    ROW_NUMBER() OVER (ORDER BY rcs.followers_count DESC, COALESCE(rs.total_earnings, 0) DESC)::bigint AS rank
  FROM public.referral_challenge_standings rcs
  JOIN public.challenge_seasons cs ON cs.id = rcs.season_id AND cs.is_active = true
  JOIN public.profiles p ON p.id = rcs.user_id
  LEFT JOIN public.referral_stats rs ON rs.user_id = rcs.user_id
  WHERE rcs.followers_count > 0
  ORDER BY rank
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_referral_challenge_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_challenge_leaderboard() TO anon;
GRANT EXECUTE ON FUNCTION public.get_referral_challenge_leaderboard() TO authenticated;

-- ============================================================
-- 4. RPC: admin sets the Start / Close dates of the active challenge
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_challenge_window(
  p_admin_id UUID,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_closes_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season UUID;
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  SELECT id INTO v_season FROM public.challenge_seasons WHERE is_active = true LIMIT 1;
  IF v_season IS NULL THEN
    RAISE EXCEPTION 'No active challenge season';
  END IF;

  IF p_starts_at IS NOT NULL AND p_closes_at IS NOT NULL AND p_closes_at <= p_starts_at THEN
    RAISE EXCEPTION 'Closing date must be after the starting date';
  END IF;

  UPDATE public.challenge_seasons
  SET starts_at = COALESCE(p_starts_at, starts_at),
      closes_at = p_closes_at
  WHERE id = v_season;

  RETURN jsonb_build_object('success', TRUE, 'season_id', v_season);
END;
$$;

REVOKE ALL ON FUNCTION public.set_challenge_window(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_challenge_window(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 5. Wipe BOTH leaderboards and open a new challenge window
-- ============================================================
DROP FUNCTION IF EXISTS public.clear_leaderboard(UUID);
CREATE OR REPLACE FUNCTION public.clear_leaderboard(
  p_admin_id UUID,
  p_starts_at TIMESTAMPTZ DEFAULT NULL,
  p_closes_at TIMESTAMPTZ DEFAULT NULL
)
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

  IF p_starts_at IS NOT NULL AND p_closes_at IS NOT NULL AND p_closes_at <= p_starts_at THEN
    RAISE EXCEPTION 'Closing date must be after the starting date';
  END IF;

  SELECT id INTO v_old_season
  FROM public.challenge_seasons
  WHERE is_active = true
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_old_season IS NOT NULL THEN
    -- Archive AI Challenge standings
    INSERT INTO public.challenge_leaderboard_archive (season_id, user_id, full_name, funding_readiness_score, xp_total, composite_score, rank, archived_at)
    SELECT cl.season_id, cl.user_id, p.full_name, cl.funding_readiness_score, cl.xp_total, cl.composite_score,
           ROW_NUMBER() OVER (ORDER BY cl.composite_score DESC, cl.funding_readiness_score DESC, cl.xp_total DESC),
           now()
    FROM public.challenge_leaderboard cl
    LEFT JOIN public.profiles p ON p.id = cl.user_id
    WHERE cl.season_id = v_old_season;

    -- Archive + WIPE the referral standings (the winner-deciding board)
    INSERT INTO public.referral_challenge_standings_archive (season_id, user_id, full_name, followers_count, rank, archived_at)
    SELECT rcs.season_id, rcs.user_id, p.full_name, rcs.followers_count,
           ROW_NUMBER() OVER (ORDER BY rcs.followers_count DESC),
           now()
    FROM public.referral_challenge_standings rcs
    LEFT JOIN public.profiles p ON p.id = rcs.user_id
    WHERE rcs.season_id = v_old_season;

    DELETE FROM public.referral_challenge_standings WHERE season_id = v_old_season;

    UPDATE public.challenge_seasons
    SET is_active = false, ended_at = now()
    WHERE id = v_old_season;
  END IF;

  SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(name, '[^0-9]', '', 'g'), '')::INTEGER), 0) + 1
  INTO v_season_number
  FROM public.challenge_seasons;

  INSERT INTO public.challenge_seasons (name, started_at, starts_at, closes_at, is_active)
  VALUES ('Challenge ' || COALESCE(v_season_number, 1), COALESCE(p_starts_at, now()), COALESCE(p_starts_at, now()), p_closes_at, true)
  RETURNING id INTO v_new_season;

  RETURN jsonb_build_object('success', TRUE, 'new_season_id', v_new_season, 'name', 'Challenge ' || COALESCE(v_season_number, 1));
END;
$$;

REVOKE ALL ON FUNCTION public.clear_leaderboard(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_leaderboard(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- 6. Gate the AI Challenge sync on activity INSIDE the season window so a
--    wiped challenge is not repopulated with stale lifetime data.
--    A user only appears once they earn XP or save a plan DURING the season.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_challenge_leaderboard_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season UUID;
  v_started TIMESTAMPTZ;
  v_funding INTEGER;
  v_xp INTEGER;
BEGIN
  SELECT id, starts_at INTO v_season, v_started
  FROM public.challenge_seasons
  WHERE is_active = true
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_season IS NULL THEN
    RETURN;
  END IF;

  -- Latest plan score saved/updated within the season window
  SELECT bp.funding_readiness_score INTO v_funding
  FROM public.business_plans bp
  WHERE bp.user_id = p_user_id
    AND COALESCE(bp.funding_readiness_score, 0) > 0
    AND (v_started IS NULL OR bp.updated_at >= v_started)
  ORDER BY bp.updated_at DESC, bp.created_at DESC
  LIMIT 1;

  -- Tutor XP recorded within the season window
  SELECT tul.xp_total INTO v_xp
  FROM public.tutor_user_levels tul
  WHERE tul.user_id = p_user_id
    AND (v_started IS NULL OR tul.updated_at >= v_started);

  IF COALESCE(v_funding, 0) = 0 AND COALESCE(v_xp, 0) = 0 THEN
    DELETE FROM public.challenge_leaderboard WHERE season_id = v_season AND user_id = p_user_id;
    RETURN;
  END IF;

  INSERT INTO public.challenge_leaderboard (season_id, user_id, funding_readiness_score, xp_total, composite_score, updated_at)
  VALUES (v_season, p_user_id, COALESCE(v_funding, 0), COALESCE(v_xp, 0),
          public.compute_challenge_composite(COALESCE(v_funding, 0), COALESCE(v_xp, 0)), now())
  ON CONFLICT (season_id, user_id)
  DO UPDATE SET
    funding_readiness_score = EXCLUDED.funding_readiness_score,
    xp_total = EXCLUDED.xp_total,
    composite_score = EXCLUDED.composite_score,
    updated_at = now();
END;
$$;

-- Re-seed the CURRENT season from activity since it started (replaces the old
-- lifetime backfill so the live board matches the new gating rules).
DELETE FROM public.challenge_leaderboard cl
USING public.challenge_seasons cs
WHERE cs.id = cl.season_id AND cs.is_active = true;

INSERT INTO public.challenge_leaderboard (season_id, user_id, funding_readiness_score, xp_total, composite_score, updated_at)
SELECT s.id, act.user_id,
       COALESCE(act.funding, 0),
       COALESCE(act.xp, 0),
       public.compute_challenge_composite(COALESCE(act.funding, 0), COALESCE(act.xp, 0)),
       now()
FROM (
  SELECT tul.user_id,
         (SELECT bp.funding_readiness_score
          FROM public.business_plans bp
          WHERE bp.user_id = tul.user_id
            AND COALESCE(bp.funding_readiness_score, 0) > 0
            AND bp.updated_at >= s2.starts_at
          ORDER BY bp.updated_at DESC, bp.created_at DESC LIMIT 1) AS funding,
         tul.xp_total AS xp
  FROM public.tutor_user_levels tul
  CROSS JOIN (SELECT id, starts_at FROM public.challenge_seasons WHERE is_active = true ORDER BY started_at DESC LIMIT 1) s2
  WHERE s2.starts_at IS NULL OR tul.updated_at >= s2.starts_at
) act
CROSS JOIN (SELECT id FROM public.challenge_seasons WHERE is_active = true ORDER BY started_at DESC LIMIT 1) s
WHERE act.user_id IS NOT NULL
ON CONFLICT (season_id, user_id) DO NOTHING;

-- ============================================================
-- 7. get_fha_portfolio(p_target_user): admins can inspect any user
-- ============================================================
DROP FUNCTION IF EXISTS public.get_fha_portfolio();
CREATE OR REPLACE FUNCTION public.get_fha_portfolio(p_target_user UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target UUID := COALESCE(p_target_user, auth.uid());
  v_ambassador UUID;
BEGIN
  IF v_target IS NULL THEN
    RETURN jsonb_build_object('has_ambassador', FALSE);
  END IF;

  IF v_target <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('has_ambassador', FALSE);
  END IF;

  SELECT id INTO v_ambassador FROM public.ambassadors WHERE user_id = v_target;
  IF v_ambassador IS NULL THEN
    RETURN jsonb_build_object('has_ambassador', FALSE);
  END IF;

  RETURN (
  WITH refs AS (
    SELECT r.id AS referral_id,
           r.referred_user_id AS uid,
           p.account_type,
           p.has_active_subscription,
           p.subscription_type,
           p.subscription_expires_at,
           COALESCE((SELECT SUM(c.amount) FROM public.commissions c WHERE c.referral_id = r.id AND c.source = 'subscription'), 0) AS sub_commission,
           COALESCE((SELECT SUM(c.amount) FROM public.commissions c WHERE c.referral_id = r.id AND c.source = 'audit_pack'), 0) AS pack_commission
    FROM public.referrals r
    JOIN public.profiles p ON p.id = r.referred_user_id
    WHERE r.ambassador_id = v_ambassador
      AND r.status = 'active'
  ),
  subs AS (
    SELECT uid,
           account_type,
           CASE WHEN subscription_type = 'b2b_annual' THEN 'annual' ELSE subscription_type END AS plan,
           sub_commission AS commission
    FROM refs
    WHERE has_active_subscription = TRUE
      AND (subscription_expires_at IS NULL OR subscription_expires_at > now())
  ),
  packs AS (
    SELECT r.uid,
           r.account_type,
           r.pack_commission,
           CASE
             WHEN pck.validity_days <= 30 THEN '30'
             WHEN pck.validity_days <= 90 THEN '90'
             ELSE '360'
           END AS bucket,
           ROW_NUMBER() OVER (PARTITION BY r.uid ORDER BY pck.validity_days DESC) AS rn
    FROM refs r
    JOIN public.user_credit_packs ucp ON ucp.user_id = r.uid
    JOIN public.audit_credit_packs pck ON pck.id = ucp.pack_id
    WHERE ucp.status = 'active'
      AND (ucp.expires_at IS NULL OR ucp.expires_at > now())
  ),
  pack_counts AS (
    SELECT account_type, bucket, COUNT(DISTINCT uid) AS users
    FROM packs
    GROUP BY account_type, bucket
  ),
  pack_commissions AS (
    SELECT account_type, bucket, COALESCE(SUM(pack_commission), 0) AS commission
    FROM packs
    WHERE rn = 1
    GROUP BY account_type, bucket
  ),
  sub_counts AS (
    SELECT account_type, plan, COUNT(DISTINCT uid) AS users, COALESCE(SUM(commission), 0) AS commission
    FROM subs
    GROUP BY account_type, plan
  )
  SELECT jsonb_build_object(
    'has_ambassador', TRUE,
    'packs', jsonb_build_object(
      'individuals', jsonb_build_object(
        'buckets', jsonb_build_object(
          '30', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'individual' AND bucket = '30'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'individual' AND bucket = '30'), 0)),
          '90', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'individual' AND bucket = '90'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'individual' AND bucket = '90'), 0)),
          '360', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'individual' AND bucket = '360'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'individual' AND bucket = '360'), 0))
        ),
        'total_users', COALESCE((SELECT COUNT(DISTINCT uid) FROM packs WHERE account_type = 'individual'), 0),
        'total_commission', COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'individual'), 0)
      ),
      'businesses', jsonb_build_object(
        'buckets', jsonb_build_object(
          '30', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'business' AND bucket = '30'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'business' AND bucket = '30'), 0)),
          '90', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'business' AND bucket = '90'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'business' AND bucket = '90'), 0)),
          '360', jsonb_build_object(
            'users', COALESCE((SELECT users FROM pack_counts WHERE account_type = 'business' AND bucket = '360'), 0),
            'commission', COALESCE((SELECT commission FROM pack_commissions WHERE account_type = 'business' AND bucket = '360'), 0))
        ),
        'total_users', COALESCE((SELECT COUNT(DISTINCT uid) FROM packs WHERE account_type = 'business'), 0),
        'total_commission', COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'business'), 0)
      )
    ),
    'subscribers', jsonb_build_object(
      'individuals', jsonb_build_object(
        'buckets', jsonb_build_object(
          'monthly', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'individual' AND plan = 'monthly'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'individual' AND plan = 'monthly'), 0)),
          'quarterly', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'individual' AND plan = 'quarterly'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'individual' AND plan = 'quarterly'), 0)),
          'biennial', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'individual' AND plan = 'biennial'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'individual' AND plan = 'biennial'), 0)),
          'annual', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'individual' AND plan = 'annual'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'individual' AND plan = 'annual'), 0))
        ),
        'total_users', COALESCE((SELECT SUM(users) FROM sub_counts WHERE account_type = 'individual'), 0),
        'total_commission', COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'individual'), 0)
      ),
      'businesses', jsonb_build_object(
        'buckets', jsonb_build_object(
          'monthly', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'business' AND plan = 'monthly'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'business' AND plan = 'monthly'), 0)),
          'quarterly', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'business' AND plan = 'quarterly'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'business' AND plan = 'quarterly'), 0)),
          'biennial', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'business' AND plan = 'biennial'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'business' AND plan = 'biennial'), 0)),
          'annual', jsonb_build_object(
            'users', COALESCE((SELECT users FROM sub_counts WHERE account_type = 'business' AND plan = 'annual'), 0),
            'commission', COALESCE((SELECT commission FROM sub_counts WHERE account_type = 'business' AND plan = 'annual'), 0))
        ),
        'total_users', COALESCE((SELECT SUM(users) FROM sub_counts WHERE account_type = 'business'), 0),
        'total_commission', COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'business'), 0)
      )
    ),
    'total_earned_individuals',
      COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'individual'), 0)
      + COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'individual'), 0),
    'total_earned_businesses',
      COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'business'), 0)
      + COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'business'), 0),
    'current_portfolio_value',
      COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'individual'), 0)
      + COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'individual'), 0)
      + COALESCE((SELECT SUM(commission) FROM pack_commissions WHERE account_type = 'business'), 0)
      + COALESCE((SELECT SUM(commission) FROM sub_counts WHERE account_type = 'business'), 0)
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.get_fha_portfolio(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_fha_portfolio(UUID) TO authenticated;

-- ============================================================
-- 8. apply_referral_code(): reliable referral linking at signup
--    (client-side updates could silently fail -> referrers never showed up)
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_referral_code(p_referral_code TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer UUID;
BEGIN
  IF auth.uid() IS NULL OR p_referral_code IS NULL OR BTRIM(p_referral_code) = '' THEN
    RETURN FALSE;
  END IF;

  SELECT id INTO v_referrer
  FROM public.profiles
  WHERE LOWER(referral_code) = LOWER(BTRIM(p_referral_code))
  LIMIT 1;

  IF v_referrer IS NULL OR v_referrer = auth.uid() THEN
    RETURN FALSE;
  END IF;

  UPDATE public.profiles
  SET referred_by = v_referrer
  WHERE id = auth.uid()
    AND referred_by IS DISTINCT FROM v_referrer;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_referral_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(TEXT) TO authenticated;

-- ============================================================
-- 9. Backfill the 2% indirect commission for historical payments
--    Idempotent: skips any (ambassador, referral, amount) already paid.
-- ============================================================
DO $$
DECLARE
  r RECORD;
  v_payer UUID;
  v_referrer UUID;
  v_grand UUID;
  v_amb UUID;
  v_ref_id UUID;
  v_wallet_id UUID;
BEGIN
  FOR r IN
    SELECT sp.user_id AS payer, (sp.amount_kobo::NUMERIC / 100.0) AS amount, 'subscription'::TEXT AS src
    FROM public.subscription_payments sp
    WHERE sp.status = 'completed'
    UNION ALL
    SELECT ap.user_id, (ap.amount_kobo::NUMERIC / 100.0), 'audit_pack'::TEXT
    FROM public.audit_pack_payments ap
    WHERE ap.status = 'completed'
  LOOP
    v_payer := r.payer;

    SELECT referred_by INTO v_referrer FROM public.profiles WHERE id = v_payer;
    CONTINUE WHEN v_referrer IS NULL OR v_referrer = v_payer;

    SELECT referred_by INTO v_grand FROM public.profiles WHERE id = v_referrer;
    CONTINUE WHEN v_grand IS NULL OR v_grand = v_payer OR v_grand = v_referrer;

    SELECT id INTO v_amb FROM public.ambassadors WHERE user_id = v_grand AND is_active = TRUE;
    CONTINUE WHEN v_amb IS NULL;

    INSERT INTO public.referrals (ambassador_id, referred_user_id, status, created_at)
    VALUES (v_amb, v_referrer, 'active', now())
    ON CONFLICT (ambassador_id, referred_user_id) DO UPDATE SET status = 'active';

    SELECT id INTO v_ref_id
    FROM public.referrals
    WHERE ambassador_id = v_amb AND referred_user_id = v_referrer;

    DECLARE
      v_bonus NUMERIC := (r.amount / 1.075) * 0.02; -- VAT-exclusive base x 2%
    BEGIN
      CONTINUE WHEN COALESCE(v_bonus, 0) <= 0;

      -- Skip if this exact indirect payout was already recorded
      IF EXISTS (
        SELECT 1 FROM public.commissions c
        WHERE c.ambassador_id = v_amb
          AND c.referral_id = v_ref_id
          AND c.commission_type = 'indirect'
          AND c.amount = v_bonus
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.commissions (ambassador_id, referral_id, amount, commission_type, source)
      VALUES (v_amb, v_ref_id, v_bonus, 'indirect', r.src);

      UPDATE public.ambassadors
      SET total_earnings = total_earnings + v_bonus, updated_at = now()
      WHERE id = v_amb;

      INSERT INTO public.referral_stats (user_id, total_earnings)
      VALUES (v_grand, v_bonus)
      ON CONFLICT (user_id) DO UPDATE
        SET total_earnings = public.referral_stats.total_earnings + EXCLUDED.total_earnings,
            updated_at = now();

      SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_grand;
      IF v_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
        SET user_wallet_balance = user_wallet_balance + v_bonus, updated_at = now()
        WHERE id = v_wallet_id;

        INSERT INTO public.wallet_transactions (wallet_id, amount, transaction_type, narration, source, status)
        VALUES (
          v_wallet_id,
          v_bonus,
          'credit',
          'Backfill: Ambassador indirect bonus (2%) on referral network purchase',
          'ambassador_commission',
          'completed'
        );
      END IF;
    END;
  END LOOP;
END $$;
