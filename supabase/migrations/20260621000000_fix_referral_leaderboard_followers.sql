-- Fix referral leaderboard to count followers (profiles with referred_by) instead of using referral_stats.total_signups
CREATE OR REPLACE FUNCTION public.get_referral_leaderboard()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  referral_count bigint,
  total_earnings decimal,
  rank bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id AS user_id,
    p.full_name,
    COUNT(DISTINCT referred.id)::bigint AS referral_count,
    COALESCE(rs.total_earnings, 0) AS total_earnings,
    ROW_NUMBER() OVER (ORDER BY COUNT(DISTINCT referred.id) DESC, COALESCE(rs.total_earnings, 0) DESC) AS rank
  FROM public.profiles AS p
  LEFT JOIN public.profiles AS referred ON referred.referred_by = p.id
  LEFT JOIN public.referral_stats AS rs ON rs.user_id = p.id
  GROUP BY p.id, p.full_name, rs.total_earnings
  HAVING COUNT(DISTINCT referred.id) > 0
  ORDER BY referral_count DESC, total_earnings DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_referral_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_leaderboard() TO anon;
GRANT EXECUTE ON FUNCTION public.get_referral_leaderboard() TO authenticated;
