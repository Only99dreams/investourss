-- ============================================================
-- Fix: posts.category is still the post_category enum
-- ============================================================
-- The community composer sends the category chosen from the admin-managed
-- post_categories table (funding_grants, jobs_gigs, scholarships, ...).
-- posts.category was originally the enum
--   public.post_category = ('education','finance','climate','investment',
--                           'advert','scam_alert','announcement')
-- so every one of those values is rejected with
--   invalid input value for enum post_category
-- and the composer shows a generic "posting error".
--
-- 20260724000000_flexible_categories_and_admin_delete.sql was supposed to
-- convert the column to TEXT, but it is evidently not applied to the live
-- database. This migration performs that conversion conditionally, so it is
-- safe whether or not that migration has run.
--
-- Idempotent: re-running is a no-op once the column is TEXT.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'category'
      AND data_type = 'user-defined'   -- still an enum
  ) THEN
    -- Preserve existing values before swapping the column out.
    ALTER TABLE public.posts ADD COLUMN category_text TEXT;
    UPDATE public.posts SET category_text = category::text;
    ALTER TABLE public.posts DROP COLUMN category;
    ALTER TABLE public.posts RENAME COLUMN category_text TO category;
    ALTER TABLE public.posts ALTER COLUMN category SET DEFAULT 'general';
    ALTER TABLE public.posts ALTER COLUMN category SET NOT NULL;

    RAISE NOTICE 'posts.category converted from post_category enum to TEXT';
  ELSE
    RAISE NOTICE 'posts.category is already TEXT - nothing to convert';
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- Make sure the admin-managed category rows the composer reads exist
-- ------------------------------------------------------------------
INSERT INTO public.post_categories (name, label, icon, color, sort_order)
VALUES
  ('funding_grants',  'Funding & Grants',            'Banknote',   'bg-green-100 text-green-800',   1),
  ('jobs_gigs',       'Jobs & Gigs',                 'Briefcase',  'bg-blue-100 text-blue-800',     2),
  ('partnerships',    'Partnerships',                'Handshake',  'bg-purple-100 text-purple-800', 3),
  ('accelerators',    'Accelerators & Competitions', 'Rocket',     'bg-orange-100 text-orange-800', 4),
  ('scholarships',    'Scholarships & Fellowships',  'GraduationCap', 'bg-indigo-100 text-indigo-800', 5),
  ('training_events', 'Training & Events',           'Calendar',   'bg-yellow-100 text-yellow-800', 6),
  ('announcements',   'Community Announcements',     'Megaphone',  'bg-red-100 text-red-800',       7),
  ('general',         'General',                     'MessageSquare', 'bg-gray-100 text-gray-800',    8)
ON CONFLICT (name) DO NOTHING;

-- Ensure anyone can read the active list the composer depends on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'post_categories' AND policyname = 'Anyone can view active categories'
  ) THEN
    EXECUTE 'CREATE POLICY "Anyone can view active categories"
      ON public.post_categories FOR SELECT USING (is_active = true)';
  END IF;
END;
$$;
