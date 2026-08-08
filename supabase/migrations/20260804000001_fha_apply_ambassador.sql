-- FHA: ambassador registration RPC. Reuses the user's existing profiles.referral_code
-- as the ambassador referral code (single code, two purposes). Guarded by
-- check_ambassador_eligibility(). Callable by the /ambassador frontend via
-- supabase.rpc('apply_ambassador') (user_id resolved from the JWT).
--
-- Returns: (success boolean, referral_code text, tier text, message text)

CREATE OR REPLACE FUNCTION public.apply_ambassador(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (success BOOLEAN, referral_code TEXT, tier TEXT, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral_code TEXT;
  v_tier TEXT;
  v_profile_code TEXT;
BEGIN
  -- Resolve the calling user when not explicitly passed
  IF p_user_id IS NULL THEN
    p_user_id := auth.uid();
  END IF;

  -- Membership guard: active subscription OR audit credits
  IF NOT public.check_ambassador_eligibility(p_user_id) THEN
    RETURN QUERY
      SELECT FALSE, NULL::TEXT, NULL::TEXT,
             'Ineligible: an active subscription or audit credits are required to become an ambassador.'::TEXT;
    RETURN;
  END IF;

  -- Already registered?
  SELECT a.referral_code, a.tier, a.is_active
  INTO v_referral_code, v_tier
  FROM ambassadors a
  WHERE a.user_id = p_user_id;

  IF v_referral_code IS NOT NULL THEN
    -- Reactivate if previously deactivated
    IF NOT EXISTS (SELECT 1 FROM ambassadors WHERE user_id = p_user_id AND is_active) THEN
      UPDATE ambassadors
      SET is_active = TRUE,
          updated_at = now()
      WHERE user_id = p_user_id;
      v_tier := COALESCE(v_tier, 'Star');
    END IF;

    RETURN QUERY
      SELECT TRUE, v_referral_code, COALESCE(v_tier, 'Star')::TEXT,
             'You are already registered as an ambassador.'::TEXT;
    RETURN;
  END IF;

  -- Reuse the user's existing referral code; generate one if missing (defensive)
  SELECT p.referral_code INTO v_profile_code
  FROM profiles p
  WHERE p.id = p_user_id;

  IF v_profile_code IS NULL THEN
    v_profile_code := 'INV' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
    UPDATE profiles
    SET referral_code = v_profile_code
    WHERE id = p_user_id;
  END IF;

  INSERT INTO ambassadors (user_id, referral_code, tier, total_earnings, is_active)
  VALUES (p_user_id, v_profile_code, 'Star', 0, TRUE);

  RETURN QUERY
    SELECT TRUE, v_profile_code, 'Star'::TEXT,
           'Ambassador registration successful. Welcome aboard!'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_ambassador(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_ambassador(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ambassador(UUID) TO anon;