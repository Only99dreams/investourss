-- ============================================================
-- Make posts.category accept any category name, robustly
-- ============================================================
-- 20260911000000 used ADD COLUMN / DROP COLUMN / RENAME to swap the
-- enum for TEXT. That pattern is fragile: if any earlier run of
-- 20260724000000 added `category_text` and then aborted, a re-run
-- dies on "column category_text of relation posts already exists"
-- and the whole DO block rolls back, leaving the enum in place. That
-- is why posts kept being filed under a category the database
-- silently rejected.
--
-- Converting the column in place avoids add/drop/rename entirely:
-- no dependencies to break, no partial state to trip over, and it is
-- a no-op when the column is already TEXT.
--
-- Idempotent and safe to re-run.

-- ============================================================
-- 1. enum -> TEXT, in place
-- ============================================================
DO $$
DECLARE
  v_is_enum BOOLEAN;
BEGIN
  SELECT (udt_name = 'post_category') INTO v_is_enum
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'posts'
    AND column_name = 'category';

  IF v_is_enum IS NULL THEN
    RAISE NOTICE 'posts.category not found - nothing to do';
  ELSIF v_is_enum THEN
    ALTER TABLE public.posts
      ALTER COLUMN category TYPE TEXT USING category::text;
    ALTER TABLE public.posts ALTER COLUMN category SET DEFAULT 'general';
    RAISE NOTICE 'posts.category converted from post_category enum to TEXT';
  ELSE
    RAISE NOTICE 'posts.category is already TEXT - nothing to convert';
  END IF;
END;
$$;

-- Clean up any leftover from a partially applied flexible-categories run.
ALTER TABLE public.posts DROP COLUMN IF EXISTS category_text;

-- ============================================================
-- 2. Seed categories
-- ============================================================
-- The seven original enum values are included as well, because posts
-- were filed under 'finance' while the column was still the enum and
-- that category does not exist in post_categories. Without a row for
-- it those posts were unreachable through the filter row.
INSERT INTO public.post_categories (name, label, icon, color, sort_order)
VALUES
  ('funding_grants',  'Funding & Grants',            'Banknote',      'bg-green-100 text-green-800',   1),
  ('jobs_gigs',       'Jobs & Gigs',                 'Briefcase',     'bg-blue-100 text-blue-800',     2),
  ('partnerships',    'Partnerships',                'Handshake',     'bg-purple-100 text-purple-800', 3),
  ('accelerators',    'Accelerators & Competitions', 'Rocket',        'bg-orange-100 text-orange-800', 4),
  ('scholarships',    'Scholarships & Fellowships',  'GraduationCap', 'bg-indigo-100 text-indigo-800', 5),
  ('training_events', 'Training & Events',           'Calendar',      'bg-yellow-100 text-yellow-800', 6),
  ('announcements',   'Community Announcements',     'Megaphone',     'bg-red-100 text-red-800',       7),
  ('general',         'General',                     'Tag',           'bg-gray-100 text-gray-800',     8),
  ('finance',         'Finance',                     'Banknote',      'bg-green-100 text-green-800',   9),
  ('education',       'Education',                   'GraduationCap', 'bg-indigo-100 text-indigo-800', 10),
  ('investment',      'Investment',                  'TrendingUp',    'bg-blue-100 text-blue-800',     11),
  ('climate',         'Climate',                     'Leaf',          'bg-emerald-100 text-emerald-800', 12),
  ('announcement',    'Announcement',                'Megaphone',     'bg-red-100 text-red-800',       13),
  ('advert',          'Advert',                      'Tag',           'bg-purple-100 text-purple-800', 14),
  ('scam_alert',      'Scam Alert',                  'AlertTriangle', 'bg-orange-100 text-orange-800', 15)
ON CONFLICT (name) DO UPDATE SET
  label = EXCLUDED.label,
  icon  = EXCLUDED.icon;

-- ============================================================
-- 3. Everyone can read the active list
-- ===========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'post_categories'
      AND policyname = 'Anyone can view active categories'
  ) THEN
    EXECUTE 'CREATE POLICY "Anyone can view active categories"
      ON public.post_categories FOR SELECT USING (is_active = true)';
  END IF;
END;
$$;

-- ============================================================
-- 4. Realtime, so admin reordering shows without a reload
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'post_categories'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.post_categories';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END;
$$;

-- ============================================================
-- 5. Give every category a distinct 1..N order
-- ============================================================
WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY sort_order ASC NULLS LAST, name ASC) AS rn
  FROM public.post_categories
)
UPDATE public.post_categories p
SET sort_order = ranked.rn
FROM ranked
WHERE p.id = ranked.id
  AND p.sort_order IS DISTINCT FROM ranked.rn;
