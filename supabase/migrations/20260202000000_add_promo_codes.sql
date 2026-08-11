-- Create promo_codes table
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  campaign_name VARCHAR(255) NOT NULL,
  discount_percentage DECIMAL(5,2) NOT NULL CHECK (discount_percentage > 0 AND discount_percentage <= 100),
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  plan_type VARCHAR(20) DEFAULT 'annual' CHECK (plan_type IN ('monthly', 'quarterly', 'annual')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create promo_code_uses table to track usage
CREATE TABLE IF NOT EXISTS promo_code_uses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  promo_code_id UUID REFERENCES promo_codes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ DEFAULT NOW(),
  discount_applied DECIMAL(10,2),
  plan_type VARCHAR(20),
  UNIQUE(promo_code_id, user_id) -- One use per user per code
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_promo_code_uses_user ON promo_code_uses(user_id);
CREATE INDEX IF NOT EXISTS idx_promo_code_uses_code ON promo_code_uses(promo_code_id);

-- Enable RLS
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_uses ENABLE ROW LEVEL SECURITY;

-- RLS Policies for promo_codes
CREATE POLICY "Admins can manage promo codes" ON promo_codes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Users can view active promo codes" ON promo_codes
  FOR SELECT USING (is_active = true AND (expires_at IS NULL OR expires_at > NOW()));

-- RLS Policies for promo_code_uses
CREATE POLICY "Users can view their own usage" ON promo_code_uses
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can view all usage" ON promo_code_uses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "System can insert usage" ON promo_code_uses
  FOR INSERT WITH CHECK (true);

-- Function to generate random promo code
CREATE OR REPLACE FUNCTION generate_promo_code(length INTEGER DEFAULT 8)
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result TEXT := '';
  i INTEGER := 0;
BEGIN
  FOR i IN 1..length LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to validate and apply promo code
CREATE OR REPLACE FUNCTION validate_promo_code(
  p_code TEXT,
  p_user_id UUID,
  p_plan_type TEXT DEFAULT 'annual'
) RETURNS JSON AS $$
DECLARE
  promo_record RECORD;
  result JSON;
BEGIN
  -- Find the promo code
  SELECT * INTO promo_record
  FROM promo_codes
  WHERE code = UPPER(p_code)
  AND is_active = true
  AND (expires_at IS NULL OR expires_at > NOW())
  AND plan_type = p_plan_type;

  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'message', 'Invalid or expired promo code');
  END IF;

  -- Check if user already used this code
  IF EXISTS (
    SELECT 1 FROM promo_code_uses
    WHERE promo_code_id = promo_record.id
    AND user_id = p_user_id
  ) THEN
    RETURN json_build_object('valid', false, 'message', 'Promo code already used by this account');
  END IF;

  -- Check usage limit
  IF promo_record.used_count >= promo_record.max_uses THEN
    RETURN json_build_object('valid', false, 'message', 'Promo code usage limit exceeded');
  END IF;

  RETURN json_build_object(
    'valid', true,
    'discount_percentage', promo_record.discount_percentage,
    'promo_code_id', promo_record.id,
    'message', 'Promo code applied successfully'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to increment promo code usage
CREATE OR REPLACE FUNCTION increment_promo_usage(promo_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE promo_codes
  SET used_count = used_count + 1
  WHERE id = promo_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;