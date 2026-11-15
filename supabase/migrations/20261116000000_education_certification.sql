-- Education & Mentorship: certification course catalogue and user requests.
--
-- Certification courses live separately from the video modules so the admin
-- can publish a catalogue of certificate programmes, users can request one
-- from a dropdown, and admins can approve requests individually or in bulk.

-- Make sure the "Certification" category exists for the Education CMS.
INSERT INTO public.content_categories (name, description, is_bde_only)
SELECT 'Certification', 'Courses that lead to a training certification', FALSE
WHERE NOT EXISTS (
  SELECT 1 FROM public.content_categories WHERE lower(name) = lower('Certification')
);

CREATE TABLE IF NOT EXISTS public.education_certification_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'Certification',
  tier_required TEXT DEFAULT 'free',
  is_published BOOLEAN DEFAULT TRUE,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.education_certification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  course_id UUID REFERENCES public.education_certification_courses(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  note TEXT,
  admin_notes TEXT,
  certificate_number TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- A user can only have one open request per course. Once it is reviewed they
-- can apply again (for example after an initial rejection).
CREATE UNIQUE INDEX IF NOT EXISTS education_certification_requests_pending_key
  ON public.education_certification_requests (user_id, course_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS education_certification_requests_course_idx
  ON public.education_certification_requests (course_id, status);

CREATE INDEX IF NOT EXISTS education_certification_requests_user_idx
  ON public.education_certification_requests (user_id, requested_at DESC);

ALTER TABLE public.education_certification_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_certification_requests ENABLE ROW LEVEL SECURITY;

-- Courses: published courses are readable by everyone signed in; admins see
-- and manage everything (including drafts).
CREATE POLICY "Anyone can view published certification courses"
  ON public.education_certification_courses
  FOR SELECT
  USING (is_published = TRUE OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage certification courses"
  ON public.education_certification_courses
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Requests: users see their own, admins see and manage all.
CREATE POLICY "Users can view their own certification requests"
  ON public.education_certification_requests
  FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can request their own certification"
  ON public.education_certification_requests
  FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins can manage certification requests"
  ON public.education_certification_requests
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_education_certification_courses_updated_at
  ON public.education_certification_courses;
CREATE TRIGGER update_education_certification_courses_updated_at
  BEFORE UPDATE ON public.education_certification_courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_education_certification_requests_updated_at
  ON public.education_certification_requests;
CREATE TRIGGER update_education_certification_requests_updated_at
  BEFORE UPDATE ON public.education_certification_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
