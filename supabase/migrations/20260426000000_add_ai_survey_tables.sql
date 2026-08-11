-- Add survey/feedback tables for AI tool impact tracking
-- Supports anonymous tracking via session_id

-- ============================================================
-- Tutor Survey Responses (before/after lesson)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tutor_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,
  topic TEXT,
  -- Pre-lesson
  pre_understanding TEXT CHECK (pre_understanding IN ('well', 'slightly', 'not_at_all')),
  -- Post-lesson
  completed TEXT CHECK (completed IN ('yes', 'partially', 'no')),
  helpfulness TEXT CHECK (helpfulness IN ('very_helpful', 'somewhat_helpful', 'not_helpful')),
  post_understanding TEXT CHECK (post_understanding IN ('well', 'slightly', 'not_at_all')),
  what_gained TEXT,
  wants_advanced TEXT CHECK (wants_advanced IN ('yes', 'maybe', 'no')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Scam Detector Survey Responses (post-detection)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.scam_detector_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,
  identified_risk TEXT CHECK (identified_risk IN ('yes', 'not_sure', 'no')),
  action_taken TEXT CHECK (action_taken IN ('avoided', 'cautious', 'continued')),
  confidence_after TEXT CHECK (confidence_after IN ('more_confident', 'slightly_confident', 'no_difference')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.tutor_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scam_detector_survey_responses ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous) can insert
CREATE POLICY "Anyone can insert tutor survey"
  ON public.tutor_survey_responses FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can insert scam survey"
  ON public.scam_detector_survey_responses FOR INSERT
  WITH CHECK (true);

-- Users can read their own
CREATE POLICY "Users read own tutor surveys"
  ON public.tutor_survey_responses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users read own scam surveys"
  ON public.scam_detector_survey_responses FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can read all
CREATE POLICY "Admins read all tutor surveys"
  ON public.tutor_survey_responses FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins read all scam surveys"
  ON public.scam_detector_survey_responses FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Indexes for admin analytics queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tutor_survey_created_at
  ON public.tutor_survey_responses (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scam_survey_created_at
  ON public.scam_detector_survey_responses (created_at DESC);
