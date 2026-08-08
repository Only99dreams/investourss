-- Remove the forced password-reset prompt on login.
-- 20260807000000_force_password_reset.sql set must_reset_password = TRUE for all
-- existing (migrated) users; the app no longer enforces the reset, so clear it.
UPDATE public.profiles SET must_reset_password = FALSE WHERE must_reset_password = TRUE;
