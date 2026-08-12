-- Referral click tracking
--
-- The referral link (/signup?ref=CODE) never incremented referral_stats.total_clicks,
-- so "Total Clicks" on the Followers dashboard always read 0. This adds a
-- SECURITY DEFINER RPC that bumps the referrer's click counter. The signup page
-- calls it whenever it loads with a ?ref= code in the URL (fire-and-forget).

CREATE OR REPLACE FUNCTION public.record_referral_click(p_code TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles WHERE referral_code = p_code;
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.referral_stats (user_id, total_clicks, created_at, updated_at)
  VALUES (v_user_id, 1, now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET total_clicks = public.referral_stats.total_clicks + 1,
                updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_referral_click(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_referral_click(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.record_referral_click(TEXT) TO authenticated;
