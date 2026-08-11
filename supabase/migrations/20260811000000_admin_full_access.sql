-- Grant admin@investours.com full access to all paid features without payment.
-- Idempotent: safe to run multiple times.

-- Ensure the undocumented profiles.role column exists (referenced by several RPCs).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT;

-- Ensure expiry columns exist (from 20260809000001; may be missing on the live DB).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audit_credits_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_subscription_expires_at
  ON public.profiles (subscription_expires_at);
CREATE INDEX IF NOT EXISTS idx_profiles_audit_credits_expires_at
  ON public.profiles (audit_credits_expires_at);

-- Ensure the admin role is registered for the admin user.
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE LOWER(email) = 'admin@investours.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Grant full access: premium tier + active annual subscription + audit credits
-- + GFE + BDE + admin role flags.
UPDATE public.profiles p
SET
  user_tier                = 'premium',
  subscription_type        = 'annual',
  has_active_subscription  = TRUE,
  subscription_expires_at  = '2999-12-31T23:59:59Z',
  audit_credits            = 999999,
  audit_credits_expires_at = '2999-12-31T23:59:59Z',
  is_gfe                   = TRUE,
  gfe_terms_agreed_at      = COALESCE(p.gfe_terms_agreed_at, NOW()),
  is_bde                   = TRUE,
  bde_status               = 'active',
  bde_assigned_at          = COALESCE(p.bde_assigned_at, NOW()),
  role                     = 'admin',
  assigned_role            = 'admin'
WHERE p.id IN (SELECT id FROM auth.users WHERE LOWER(email) = 'admin@investours.com');
