-- Certificate templates: reusable, admin-editable certificate designs.
--
-- Admins can create one template per purpose (completion, achievement,
-- participation, excellence...) and attach it to a certification course. The
-- member side previews the exact template they will receive, and approved
-- certificates render from it.
--
-- Access is subscriber-based: template gating follows the course, and courses
-- no longer use the old plan-tier field to lock requests.

CREATE TABLE IF NOT EXISTS public.certificate_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  purpose TEXT DEFAULT 'completion',
  heading TEXT NOT NULL DEFAULT 'Certificate of Completion',
  intro_text TEXT DEFAULT 'This certifies that',
  body_text TEXT DEFAULT 'has successfully completed the',
  footer_note TEXT DEFAULT 'Investours Education & Mentorship',
  issuer_name TEXT DEFAULT 'Olusegun Emmanuel',
  issuer_title TEXT DEFAULT 'Founder & CEO, Investours',
  accent_color TEXT DEFAULT '#7c3aed',
  is_published BOOLEAN DEFAULT TRUE,
  is_default BOOLEAN DEFAULT FALSE,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS certificate_templates_name_key
  ON public.certificate_templates (lower(name));

-- Only one template can be the fallback design.
CREATE UNIQUE INDEX IF NOT EXISTS certificate_templates_one_default
  ON public.certificate_templates (is_default)
  WHERE is_default = TRUE;

ALTER TABLE public.education_certification_courses
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.certificate_templates(id) ON DELETE SET NULL;

-- Snapshot the design chosen when the request is made so an approved
-- certificate keeps its template even if the course is re-pointed later.
ALTER TABLE public.education_certification_requests
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.certificate_templates(id) ON DELETE SET NULL;

ALTER TABLE public.certificate_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published certificate templates"
  ON public.certificate_templates
  FOR SELECT
  USING (is_published = TRUE OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage certificate templates"
  ON public.certificate_templates
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_certificate_templates_updated_at
  ON public.certificate_templates;
CREATE TRIGGER update_certificate_templates_updated_at
  BEFORE UPDATE ON public.certificate_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Default designs available immediately after the migration runs.
INSERT INTO public.certificate_templates
  (name, purpose, heading, intro_text, body_text, footer_note, issuer_name, issuer_title, accent_color, is_default, order_index)
SELECT * FROM (VALUES
  (
    'Certificate of Completion',
    'completion',
    'Certificate of Completion',
    'This certifies that',
    'has successfully completed the',
    'Investours Education & Mentorship',
    'Olusegun Emmanuel',
    'Founder & CEO, Investours',
    '#7c3aed',
    TRUE,
    1
  ),
  (
    'Certificate of Achievement',
    'achievement',
    'Certificate of Achievement',
    'This certificate is proudly presented to',
    'in recognition of outstanding achievement in',
    'Investours Education & Mentorship',
    'Olusegun Emmanuel',
    'Founder & CEO, Investours',
    '#059669',
    FALSE,
    2
  ),
  (
    'Certificate of Participation',
    'participation',
    'Certificate of Participation',
    'This is to certify that',
    'participated in and completed the training programme',
    'Investours Education & Mentorship',
    'Olusegun Emmanuel',
    'Founder & CEO, Investours',
    '#2563eb',
    FALSE,
    3
  ),
  (
    'Certificate of Excellence',
    'excellence',
    'Certificate of Excellence',
    'Awarded to',
    'for exceptional performance and dedication in',
    'Investours Education & Mentorship',
    'Olusegun Emmanuel',
    'Founder & CEO, Investours',
    '#d97706',
    FALSE,
    4
  )
) AS seed (name, purpose, heading, intro_text, body_text, footer_note, issuer_name, issuer_title, accent_color, is_default, order_index)
WHERE NOT EXISTS (
  SELECT 1 FROM public.certificate_templates existing
  WHERE lower(existing.name) = lower(seed.name)
);

-- Existing courses pick up the default design so they render immediately.
UPDATE public.education_certification_courses
SET template_id = (
  SELECT id FROM public.certificate_templates
  ORDER BY is_default DESC, order_index
  LIMIT 1
)
WHERE template_id IS NULL;
