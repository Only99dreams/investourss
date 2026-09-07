-- ============================================================
-- Fix referral attribution when email confirmation is enabled
-- ============================================================
-- Referral attribution previously ran client-side AFTER signup via
-- apply_referral_code(), which relies on auth.uid(). When email
-- confirmation is ON, the signed-up user has no session yet, so
-- auth.uid() is null and referred_by is never written — the new
-- follower never appears in the referrer's list.
--
-- Fix: carry the code in signup user metadata (data.referral_code)
-- and let handle_new_user() link the follower at profile creation.
-- handle_new_user fires on auth.users INSERT, so it runs even when
-- the email is still unconfirmed. apply_referral_code() stays as a
-- harmless fallback for sessions that already exist.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral_code TEXT;
  v_referrer UUID;
BEGIN
  v_referral_code := NULLIF(BTRIM(NEW.raw_user_meta_data ->> 'referral_code'), '');

  IF v_referral_code IS NOT NULL THEN
    SELECT id INTO v_referrer
    FROM public.profiles
    WHERE LOWER(referral_code) = LOWER(v_referral_code)
    LIMIT 1;

    -- Never allow self-referrals
    IF v_referrer = NEW.id THEN
      v_referrer := NULL;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    public.generate_referral_code()
  );

  IF v_referrer IS NOT NULL THEN
    UPDATE public.profiles
    SET referred_by = v_referrer
    WHERE id = NEW.id
      AND referred_by IS DISTINCT FROM v_referrer;
  END IF;

  INSERT INTO public.wallets (user_id)
  VALUES (NEW.id);

  INSERT INTO public.referral_stats (user_id)
  VALUES (NEW.id);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  RETURN NEW;
END;
$$;

-- Guard: make sure the trigger still points at the (updated) function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();