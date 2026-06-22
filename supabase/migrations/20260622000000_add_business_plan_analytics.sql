CREATE TABLE IF NOT EXISTS business_plan_analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_plan_analytics_event_type ON business_plan_analytics(event_type);
CREATE INDEX IF NOT EXISTS idx_business_plan_analytics_created_at ON business_plan_analytics(created_at);
CREATE INDEX IF NOT EXISTS idx_business_plan_analytics_user_id ON business_plan_analytics(user_id);

ALTER TABLE business_plan_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all analytics"
  ON business_plan_analytics
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can insert their own analytics"
  ON business_plan_analytics
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
