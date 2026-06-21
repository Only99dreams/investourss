-- Create user_certificates table if it doesn't exist, then add download_count column
CREATE TABLE IF NOT EXISTS user_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  level_label TEXT NOT NULL,
  xp_earned INTEGER,
  certificate_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_certificates ADD COLUMN IF NOT EXISTS download_count INTEGER DEFAULT 0;
