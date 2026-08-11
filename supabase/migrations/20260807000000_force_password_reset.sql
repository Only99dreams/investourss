-- Sync profiles schema (fills in columns missing after a database move)
-- All statements are idempotent (IF NOT EXISTS) so this is safe to run on any project.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_bde BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bde_status TEXT DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS bde_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bde_assigned_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS subscription_type TEXT DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS email_opt_in BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS engagement_credit_earned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_tutor_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS videos_watched INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posts_created INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tutor_interest TEXT,
  ADD COLUMN IF NOT EXISTS tutor_level TEXT,
  ADD COLUMN IF NOT EXISTS tutor_goal TEXT,
  ADD COLUMN IF NOT EXISTS has_active_subscription BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS audit_credits INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN DEFAULT FALSE;

-- Backfill email_opt_in (matches the original migration behaviour)
UPDATE public.profiles SET email_opt_in = TRUE WHERE email_opt_in IS NULL;

-- Existing users were migrated without passwords, so require them to reset.
-- New signups are not affected (column default = FALSE).
UPDATE public.profiles SET must_reset_password = TRUE;
