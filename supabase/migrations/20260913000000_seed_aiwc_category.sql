-- ============================================================
-- Seed the AIWC competition category
-- ============================================================
-- Posts filed under `aiwc` are Investours Idea Competition entries, and
-- every share of one has to carry the competition pitch. That depends on
-- the category existing, so make sure it is present.
--
-- Idempotent: only inserted when missing, so an admin's own label, icon,
-- colour or sort position is never overwritten.

INSERT INTO public.post_categories (name, label, icon, color, sort_order)
VALUES ('aiwc', 'Idea Competition', 'Rocket', 'bg-orange-100 text-orange-800', 0)
ON CONFLICT (name) DO NOTHING;

-- Make sure it is selectable in the composer and filter row.
UPDATE public.post_categories SET is_active = true WHERE name = 'aiwc';
