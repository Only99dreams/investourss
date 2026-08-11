-- Fix: add UNIQUE constraint on session_id so that
-- TutorPostSurvey's upsert (ON CONFLICT session_id) works correctly.
-- Without this, the upsert throws "no unique or exclusion constraint
-- matching the ON CONFLICT specification" which was silently swallowed,
-- causing all post-survey data to be lost.

ALTER TABLE public.tutor_survey_responses
  ADD CONSTRAINT tutor_survey_session_id_unique UNIQUE (session_id);

-- Also add for scam surveys (for consistency / future upsert support)
ALTER TABLE public.scam_detector_survey_responses
  ADD CONSTRAINT scam_survey_session_id_unique UNIQUE (session_id);
