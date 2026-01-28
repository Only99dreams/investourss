-- Add BDE (Business Development Executive) fields to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_bde BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS bde_status TEXT DEFAULT 'inactive' CHECK (bde_status IN ('active', 'inactive', 'suspended')),
ADD COLUMN IF NOT EXISTS bde_assigned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS bde_assigned_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS subscription_type TEXT DEFAULT 'monthly' CHECK (subscription_type IN ('monthly', 'quarterly', 'annual'));

-- Create content_categories table for BDE content
CREATE TABLE IF NOT EXISTS public.content_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_bde_only BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create education_modules_categories junction table
CREATE TABLE IF NOT EXISTS public.education_module_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID REFERENCES public.education_modules(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.content_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(module_id, category_id)
);

-- Insert default categories
INSERT INTO public.content_categories (name, description, is_bde_only) VALUES
  ('General Education', 'Basic financial literacy content', FALSE),
  ('Investment Strategies', 'Advanced investment strategies', FALSE),
  ('Risk Management', 'Risk assessment and management', FALSE),
  ('BDE Exclusive', 'Business Development Executive exclusive content', TRUE),
  ('Market Analysis', 'Market trends and analysis', FALSE),
  ('Entrepreneurship', 'Business and entrepreneurship content', FALSE)
ON CONFLICT (name) DO NOTHING;

-- Enable RLS
ALTER TABLE public.content_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_module_categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies for content_categories
CREATE POLICY "Anyone can view categories" ON public.content_categories FOR SELECT USING (true);
CREATE POLICY "Admins can manage categories" ON public.content_categories FOR ALL USING (
  public.has_role(auth.uid(), 'admin')
);

-- RLS Policies for education_module_categories
CREATE POLICY "Users can view module categories" ON public.education_module_categories FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.education_modules em
    LEFT JOIN public.content_categories cc ON em.id = education_module_categories.module_id
    WHERE em.id = education_module_categories.module_id
    AND (
      cc.is_bde_only = FALSE OR
      (cc.is_bde_only = TRUE AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
        AND p.is_bde = TRUE
        AND p.bde_status = 'active'
        AND p.user_tier = 'premium'
        AND p.subscription_type = 'annual'
      ))
    )
  )
);
CREATE POLICY "Admins can manage module categories" ON public.education_module_categories FOR ALL USING (
  public.has_role(auth.uid(), 'admin')
);