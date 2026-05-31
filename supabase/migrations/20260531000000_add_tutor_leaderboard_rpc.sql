-- Leaderboard: expose tutor XP leaderboard via RPC for frontend consumption

CREATE OR REPLACE FUNCTION public.get_tutor_leaderboard()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  email text,
  xp_total integer,
  level text,
  streak_days integer,
  badges jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tul.user_id,
    p.full_name,
    p.email,
    COALESCE(tul.xp_total, 0) AS xp_total,
    tul.level,
    COALESCE(tul.streak_days, 0) AS streak_days,
    tul.badges
  FROM public.tutor_user_levels AS tul
  JOIN public.profiles AS p ON p.id = tul.user_id
  ORDER BY tul.xp_total DESC
  LIMIT 100;
$$;