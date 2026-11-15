-- Link education videos to the certification course they belong to.
--
-- A general education video leaves this NULL. A video that prepares members
-- for a certification stores the course, so the Request Certificate tab can
-- show the course's videos and the admin list can say what the video is for.

ALTER TABLE public.education_modules
  ADD COLUMN IF NOT EXISTS certification_course_id UUID
  REFERENCES public.education_certification_courses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS education_modules_certification_course_idx
  ON public.education_modules (certification_course_id)
  WHERE certification_course_id IS NOT NULL;
