-- Create business_plans table for saving generated business plans
CREATE TABLE IF NOT EXISTS business_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Plan',
  form_data JSONB,
  plan_content TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE business_plans ENABLE ROW LEVEL SECURITY;

-- Users can CRUD their own plans
CREATE POLICY "Users can manage their own plans"
  ON business_plans
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Index for faster lookups
CREATE INDEX idx_business_plans_user_id ON business_plans(user_id);
CREATE INDEX idx_business_plans_created_at ON business_plans(created_at DESC);
