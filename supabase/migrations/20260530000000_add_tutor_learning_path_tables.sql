-- Add tables for AI Tutor learning path system
-- Stores lessons, user progress, XP, and level progression

-- ============================================================
-- Lessons table - stores all available learning lessons
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tutor_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('budgeting', 'saving', 'investing', 'credit', 'business')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  description TEXT,
  content TEXT,
  order_index INTEGER,
  xp_reward INTEGER DEFAULT 10,
  quiz JSONB,
  next_lesson_suggestion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- Tutor User Progress - tracks completed lessons and XP
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tutor_user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES public.tutor_lessons(id) ON DELETE CASCADE,
  completed BOOLEAN DEFAULT false,
  xp_earned INTEGER DEFAULT 0,
  quiz_score INTEGER,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);

-- ============================================================
-- Tutor User Level Progression
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tutor_user_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  xp_total INTEGER DEFAULT 0,
  next_level_xp INTEGER DEFAULT 100,
  badges JSONB DEFAULT '[]'::jsonb,
  last_active_date TIMESTAMPTZ,
  streak_days INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- ============================================================
-- Tutor Learning Path Assignments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tutor_learning_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  path_name TEXT NOT NULL,
  category TEXT NOT NULL,
  level TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  completed_lessons INTEGER DEFAULT 0,
  total_lessons INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.tutor_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_user_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tutor_learning_paths ENABLE ROW LEVEL SECURITY;

-- Lessons - everyone can read
CREATE POLICY "Anyone can read tutor lessons"
  ON public.tutor_lessons FOR SELECT
  USING (true);

-- Users can insert/update their own progress
CREATE POLICY "Users can insert tutor progress"
  ON public.tutor_user_progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update tutor progress"
  ON public.tutor_user_progress FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read own tutor progress"
  ON public.tutor_user_progress FOR SELECT
  USING (auth.uid() = user_id);

-- Users can read/insert/update their own levels
CREATE POLICY "Users can manage own tutor levels"
  ON public.tutor_user_levels FOR ALL
  USING (auth.uid() = user_id);

-- Users can read/insert/update their own learning paths
CREATE POLICY "Users can manage own tutor learning paths"
  ON public.tutor_learning_paths FOR ALL
  USING (auth.uid() = user_id);

-- Admins can read all
CREATE POLICY "Admins read all tutor lessons"
  ON public.tutor_lessons FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins read all tutor progress"
  ON public.tutor_user_progress FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins read all tutor levels"
  ON public.tutor_user_levels FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Admin RLS Policies for leaderboard visibility
-- ============================================================
CREATE POLICY "Admins can read all tutor levels"
  ON public.tutor_user_levels FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can read all tutor progress"
  ON public.tutor_user_progress FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- Public leaderboard RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_tutor_leaderboard()
RETURNS TABLE (
  user_id uuid,
  xp_total integer,
  level text,
  streak_days integer,
  badges jsonb,
  full_name text,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    tul.user_id,
    COALESCE(tul.xp_total, 0) AS xp_total,
    tul.level,
    COALESCE(tul.streak_days, 0) AS streak_days,
    tul.badges,
    p.full_name,
    p.email
  FROM public.tutor_user_levels AS tul
  JOIN public.profiles AS p ON p.id = tul.user_id
  ORDER BY tul.xp_total DESC
  LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.get_tutor_leaderboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tutor_leaderboard() TO anon;
GRANT EXECUTE ON FUNCTION public.get_tutor_leaderboard() TO authenticated;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tutor_lessons_category ON public.tutor_lessons (category);
CREATE INDEX IF NOT EXISTS idx_tutor_lessons_difficulty ON public.tutor_lessons (difficulty);
CREATE INDEX IF NOT EXISTS idx_tutor_user_progress_user_id ON public.tutor_user_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_tutor_user_levels_user_id ON public.tutor_user_levels (user_id);
CREATE INDEX IF NOT EXISTS idx_tutor_learning_paths_user_id ON public.tutor_learning_paths (user_id);
