-- Add email_opt_in column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS email_opt_in BOOLEAN DEFAULT true;

-- Update existing profiles to opt-in by default
UPDATE public.profiles 
SET email_opt_in = true 
WHERE email_opt_in IS NULL;

