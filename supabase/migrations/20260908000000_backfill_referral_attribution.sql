-- ============================================================
-- Backfill referral attribution for profiles that predate the
-- signup metadata fix (20260907000000).
--
-- Before that fix, referral codes were only applied client-side via
-- apply_referral_code(), which is a no-op when email confirmation is
-- ON (auth.uid() is null at signup). As a result, some existing
-- profiles have referred_by = NULL even though the referrer sent them
-- a link/code.
--
-- What this migration does:
--   1. Auto-links any profile whose auth.users.raw_user_meta_data
--      carries a referral_code (e.g. signups that used the new form
--      before the trigger/function was re-enabled, or partial states).
--   2. Idempotent: only processes profiles with referred_by IS NULL and
--      never touches profiles that are already linked.
--   3. Mirrors handle_new_user(): it only writes referred_by. It does
--      NOT bump referral_stats.total_signups because the current
--      attribution fix does not either (followers are derived directly
--      from profiles.referred_by, see
--      20260621000000_fix_referral_leaderboard_followers.sql).
--   4. Leaves a clearly marked, ready-to-edit MANUAL section below for
--      users who signed up before any referral code was recorded in
--      their auth metadata (unrecoverable from the DB alone).
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Automatic backfill from signup user metadata
-- ------------------------------------------------------------------
DO $$
DECLARE
  r            RECORD;
  v_referrer   UUID;
  v_code       TEXT;
  v_followers  INTEGER;
BEGIN
  FOR r IN
    SELECT au.id AS follower_id,
           au.email AS follower_email,
           NULLIF(BTRIM(au.raw_user_meta_data ->> 'referral_code'), '') AS code
    FROM auth.users au
    JOIN public.profiles p ON p.id = au.id
    WHERE p.referred_by IS NULL
      AND NULLIF(BTRIM(au.raw_user_meta_data ->> 'referral_code'), '') IS NOT NULL
  LOOP
    v_code := r.code;

    SELECT id INTO v_referrer
    FROM public.profiles
    WHERE LOWER(referral_code) = LOWER(v_code)
    LIMIT 1;

    -- Never allow self-referrals
    IF v_referrer IS NOT NULL AND v_referrer = r.follower_id THEN
      v_referrer := NULL;
    END IF;

    IF v_referrer IS NOT NULL THEN
      UPDATE public.profiles
      SET referred_by = v_referrer
      WHERE id = r.follower_id
        AND referred_by IS DISTINCT FROM v_referrer;

      IF FOUND THEN
        v_followers := v_followers + 1;
        RAISE NOTICE 'Linked % to referrer %', r.follower_email, v_referrer;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Referral backfill complete: % profile(s) linked', COALESCE(v_followers, 0);
END;
$$;

-- ------------------------------------------------------------------
-- 2. MANUAL backfill (optional)
--
-- Users who signed up BEFORE referral codes were stored in signup
-- metadata have no code recorded anywhere in the database, so they
-- cannot be auto-linked. To link them, fill in one row per known
-- follower as ('<follower email>', '<referral code they used>') and
-- uncomment this block before running the migration.
--
-- Example:
--   FOR r IN SELECT * FROM (VALUES
--     ('jane@example.com',  'JOHNDOE'),
--     ('kofi@example.com',   'JOHNDOE')
--   ) AS t2(follower_email, code)
--
-- DO $$
-- DECLARE
--   r          RECORD;
--   v_follower UUID;
--   v_referrer UUID;
-- BEGIN
--   FOR r IN
--     SELECT * FROM (VALUES
--       ('REPLACE_WITH_FOLLOWER_EMAIL', 'REPLACE_WITH_CODE')
--     ) AS t(follower_email, code)
--   LOOP
--     SELECT id INTO v_follower
--     FROM public.profiles
--     WHERE LOWER(email) = LOWER(BTRIM(r.follower_email))
--     LIMIT 1;

--     IF v_follower IS NULL THEN
--       RAISE NOTICE 'Skipping unknown follower email: %', r.follower_email;
--       CONTINUE;
--     END IF;

--     IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_follower AND referred_by IS NOT NULL) THEN
--       RAISE NOTICE 'Skipping % already linked', r.follower_email;
--       CONTINUE;
--     END IF;

--     SELECT id INTO v_referrer
--     FROM public.profiles
--     WHERE LOWER(referral_code) = LOWER(BTRIM(r.code))
--     LIMIT 1;

--     IF v_referrer IS NULL OR v_referrer = v_follower THEN
--       RAISE NOTICE 'Skipping %: could not resolve code %', r.follower_email, r.code;
--       CONTINUE;
--     END IF;

--     UPDATE public.profiles
--     SET referred_by = v_referrer
--     WHERE id = v_follower;

--     IF FOUND THEN
--       RAISE NOTICE 'Linked % -> referrer %', r.follower_email, r.code;
--     END IF;
--   END LOOP;
-- END;
-- $$;