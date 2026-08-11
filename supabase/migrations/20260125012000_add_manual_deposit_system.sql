-- Create deposit_requests table for manual bank transfer payments
CREATE TABLE public.deposit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method TEXT DEFAULT 'bank_transfer',
  reference_number TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  depositor_name TEXT,
  proof_of_payment_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  wallet_type TEXT DEFAULT 'user_wallet',
  processed_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMPTZ,
  admin_notes TEXT,
  narration TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.deposit_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies for deposit_requests
CREATE POLICY "Users can view their own deposit requests"
ON public.deposit_requests
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own deposit requests"
ON public.deposit_requests
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all deposit requests"
ON public.deposit_requests
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update deposit requests"
ON public.deposit_requests
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Function to process approved deposits
CREATE OR REPLACE FUNCTION public.process_deposit_request(
  request_id UUID,
  admin_id UUID,
  action TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deposit_record RECORD;
  admin_profile RECORD;
  narration_text TEXT;
BEGIN
  -- Get deposit request
  SELECT * INTO deposit_record FROM deposit_requests WHERE id = request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deposit request not found';
  END IF;

  -- Get admin profile for narration
  SELECT full_name INTO admin_profile FROM profiles WHERE id = admin_id;

  IF action = 'approve' THEN
    -- Update deposit request
    UPDATE deposit_requests
    SET status = 'approved',
        processed_by = admin_id,
        processed_at = NOW(),
        narration = CONCAT('Approved by ', COALESCE(admin_profile.full_name, 'Admin'), ' - Manual Bank Transfer')
    WHERE id = request_id;

    -- Check if this is a subscription payment
    IF deposit_record.narration LIKE '%subscription%' OR deposit_record.narration LIKE '%Premium%' THEN
      -- Update user tier to premium
      UPDATE profiles
      SET user_tier = 'premium',
          subscription_type = CASE
            WHEN deposit_record.narration LIKE '%monthly%' THEN 'monthly'
            WHEN deposit_record.narration LIKE '%quarterly%' THEN 'quarterly'
            WHEN deposit_record.narration LIKE '%annual%' THEN 'annual'
            ELSE 'monthly'
          END,
          updated_at = NOW()
      WHERE id = deposit_record.user_id;

      -- Create transaction record for subscription
      INSERT INTO wallet_transactions (
        wallet_id,
        amount,
        transaction_type,
        narration,
        source,
        status,
        actor_id
      )
      SELECT
        w.id,
        deposit_record.amount,
        'credit',
        CONCAT('Premium Subscription - Approved by ', COALESCE(admin_profile.full_name, 'Admin')),
        'subscription_payment',
        'completed',
        admin_id
      FROM wallets w WHERE w.user_id = deposit_record.user_id;

      -- Create notification for subscription activation
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (
        deposit_record.user_id,
        '🎉 Premium Subscription Activated!',
        CONCAT('Your premium subscription has been activated! You now have access to all premium features.'),
        'subscription_activated'
      );

    ELSE
      -- Regular wallet deposit
      UPDATE wallets
      SET user_wallet_balance = user_wallet_balance + deposit_record.amount,
          updated_at = NOW()
      WHERE user_id = deposit_record.user_id;

      -- Create transaction record
      INSERT INTO wallet_transactions (
        wallet_id,
        amount,
        transaction_type,
        narration,
        source,
        status,
        actor_id
      )
      SELECT
        w.id,
        deposit_record.amount,
        'credit',
        CONCAT('Manual Bank Transfer - Approved by ', COALESCE(admin_profile.full_name, 'Admin')),
        'manual_deposit',
        'completed',
        admin_id
      FROM wallets w WHERE w.user_id = deposit_record.user_id;

      -- Create notification
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (
        deposit_record.user_id,
        '💰 Deposit Approved',
        CONCAT('Your manual bank transfer of ₦', deposit_record.amount::text, ' has been approved and credited to your wallet.'),
        'deposit_approved'
      );
    END IF;

  ELSIF action = 'reject' THEN
    -- Update deposit request
    UPDATE deposit_requests
    SET status = 'rejected',
        processed_by = admin_id,
        processed_at = NOW(),
        narration = CONCAT('Rejected by ', COALESCE(admin_profile.full_name, 'Admin'))
    WHERE id = request_id;

    -- Create notification
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      deposit_record.user_id,
      '❌ Deposit Rejected',
      CONCAT('Your manual bank transfer request of ₦', deposit_record.amount::text, ' has been rejected. Please contact support for details.'),
      'deposit_rejected'
    );
  END IF;

  RETURN TRUE;
END;
$$;

-- Add thumbnail_url column to education_modules if it doesn't exist
ALTER TABLE public.education_modules
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

-- Add content_categories and education_module_categories tables if they don't exist
CREATE TABLE IF NOT EXISTS public.content_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_bde_only BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.education_module_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID REFERENCES public.education_modules(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.content_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on new tables
ALTER TABLE public.content_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_module_categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view content categories"
ON public.content_categories
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage content categories"
ON public.content_categories
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view module categories"
ON public.education_module_categories
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage module categories"
ON public.education_module_categories
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create storage bucket for attachments (proof of payment, etc.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', true);

-- Storage policies for attachments bucket
CREATE POLICY "Users can upload their own attachments"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can view their own attachments"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'attachments'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Admins can view all attachments"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'attachments'
  AND has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Admins can manage all attachments"
ON storage.objects
FOR ALL
USING (
  bucket_id = 'attachments'
  AND has_role(auth.uid(), 'admin'::app_role)
);