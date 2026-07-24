-- Migration: Make post categories flexible and add admin-managed categories table
-- This migration converts the category column from enum to TEXT and creates
-- a post_categories table that admins can manage.

-- 1. Add new column as TEXT
ALTER TABLE public.posts ADD COLUMN category_text TEXT;

-- 2. Copy existing enum values to the new TEXT column
UPDATE public.posts SET category_text = category::text;

-- 3. Drop the old enum column
ALTER TABLE public.posts DROP COLUMN category;

-- 4. Rename the new column
ALTER TABLE public.posts RENAME COLUMN category_text TO category;

-- 5. Set default and NOT NULL
ALTER TABLE public.posts ALTER COLUMN category SET DEFAULT 'general';
ALTER TABLE public.posts ALTER COLUMN category SET NOT NULL;

-- 6. Create post_categories table for admin-managed categories
CREATE TABLE IF NOT EXISTS public.post_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  icon TEXT DEFAULT 'Tag',
  color TEXT DEFAULT 'bg-gray-100 text-gray-800',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Insert default categories
INSERT INTO public.post_categories (name, label, icon, color, sort_order) VALUES
  ('funding_grants', 'Funding & Grants', 'Banknote', 'bg-green-100 text-green-800', 1),
  ('jobs_gigs', 'Jobs & Gigs', 'Briefcase', 'bg-blue-100 text-blue-800', 2),
  ('partnerships', 'Partnerships', 'Handshake', 'bg-purple-100 text-purple-800', 3),
  ('accelerators', 'Accelerators & Competitions', 'Rocket', 'bg-orange-100 text-orange-800', 4),
  ('scholarships', 'Scholarships & Fellowships', 'GraduationCap', 'bg-indigo-100 text-indigo-800', 5),
  ('training_events', 'Training & Events', 'Calendar', 'bg-yellow-100 text-yellow-800', 6),
  ('announcements', 'Community Announcements', 'Megaphone', 'bg-red-100 text-red-800', 7),
  ('general', 'General', 'MessageSquare', 'bg-gray-100 text-gray-800', 8)
ON CONFLICT (name) DO NOTHING;

-- 8. Enable RLS on post_categories
ALTER TABLE public.post_categories ENABLE ROW LEVEL SECURITY;

-- 9. Everyone can read active categories
CREATE POLICY "Anyone can view active categories"
  ON public.post_categories
  FOR SELECT
  USING (is_active = true);

-- 10. Admins can manage categories (insert, update, delete)
CREATE POLICY "Admins can manage categories"
  ON public.post_categories
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.assigned_role = 'admin'
    )
  );

-- 11. Enable RLS on posts if not already enabled
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- 12. Allow admins to delete posts
CREATE POLICY "Admins can delete posts"
  ON public.posts
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.assigned_role = 'admin'
    )
  );
