-- Fix: "Database error querying schema" on login (GoTrue 500).
-- Cause: users inserted directly into auth.users (database move) left GoTrue's
-- text-token columns NULL. GoTrue scans these into Go `string` values, so NULL
-- crashes it during password sign-in.
-- These columns must be empty string, never NULL, for GoTrue to work.
--
-- Note: only the UPDATEs are included on purpose. ALTER TABLE auth.users
-- requires ownership (the table is owned by supabase_auth_admin, and hosted
-- Supabase grants postgres no superuser), so the DEFAULT safeguards were left
-- out. The UPDATEs alone resolve the login error.
UPDATE auth.users SET confirmation_token = '' WHERE confirmation_token IS NULL;
UPDATE auth.users SET recovery_token = '' WHERE recovery_token IS NULL;
UPDATE auth.users SET email_change_token_new = '' WHERE email_change_token_new IS NULL;
UPDATE auth.users SET email_change_token_current = '' WHERE email_change_token_current IS NULL;
UPDATE auth.users SET email_change = '' WHERE email_change IS NULL;
UPDATE auth.users SET phone_change = '' WHERE phone_change IS NULL;
UPDATE auth.users SET phone_change_token = '' WHERE phone_change_token IS NULL;
UPDATE auth.users SET reauthentication_token = '' WHERE reauthentication_token IS NULL;

-- Newer GoTrue scans email_change_confirm_status as an integer; NULL also crashes it.
-- Guarded in case this project's auth.users predates that column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name = 'email_change_confirm_status'
  ) THEN
    UPDATE auth.users SET email_change_confirm_status = 0 WHERE email_change_confirm_status IS NULL;
  END IF;
END;
$$;
