-- Consolidate the legacy group/firm user types into Business so the admin
-- Type column matches the signup choices (Individual / Business / B2B).

UPDATE public.profiles
SET user_type = 'business'
WHERE user_type IN ('group', 'firm');

ALTER TABLE public.profiles ALTER COLUMN user_type SET DEFAULT 'individual';

-- Education rows still store the old tier names. Map them onto the plan they
-- represented: premium meant any paid subscriber, exclusive meant the top plan.
UPDATE public.education_modules
SET tier_required = 'monthly'
WHERE tier_required = 'premium';

UPDATE public.education_modules
SET tier_required = 'annual'
WHERE tier_required = 'exclusive';

UPDATE public.education_certification_courses
SET tier_required = 'monthly'
WHERE tier_required = 'premium';

UPDATE public.education_certification_courses
SET tier_required = 'annual'
WHERE tier_required = 'exclusive';
