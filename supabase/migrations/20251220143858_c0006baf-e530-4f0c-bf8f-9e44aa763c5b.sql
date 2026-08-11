-- Create app_role enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user', 'gfe', 'firm_admin', 'firm_staff');

-- Create user_type enum
CREATE TYPE public.user_type AS ENUM ('individual', 'group', 'firm');

-- Create user_tier enum
CREATE TYPE public.user_tier AS ENUM ('free', 'premium', 'exclusive');

-- Create post_category enum
CREATE TYPE public.post_category AS ENUM ('education', 'finance', 'climate', 'investment', 'advert', 'scam_alert', 'announcement');

-- Create investment_status enum
CREATE TYPE public.investment_status AS ENUM ('pending', 'approved', 'rejected', 'paused', 'flagged', 'archived');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  country TEXT,
  region TEXT,
  gender TEXT,
  date_of_birth DATE,
  disability_status TEXT,
  occupation TEXT,
  sector TEXT,
  institution TEXT,
  languages_spoken TEXT[],
  preferred_language TEXT DEFAULT 'en',
  residential_address TEXT,
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES public.profiles(id),
  user_type public.user_type DEFAULT 'individual',
  user_tier public.user_tier DEFAULT 'free',
  is_gfe BOOLEAN DEFAULT FALSE,
  gfe_terms_agreed_at TIMESTAMPTZ,
  onboarding_completed BOOLEAN DEFAULT FALSE,
  profile_completed BOOLEAN DEFAULT FALSE,
  signup_reasons TEXT[],
  assigned_role TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_roles table (separate from profiles for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, role)
);

-- Create groups table (for cooperative, NGO, etc.)
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  group_name TEXT NOT NULL,
  group_type TEXT NOT NULL,
  logo_url TEXT,
  group_email TEXT,
  group_phone TEXT,
  group_address TEXT,
  group_size TEXT,
  country TEXT,
  region TEXT,
  contact_person_name TEXT,
  contact_person_email TEXT,
  contact_person_phone TEXT,
  user_tier public.user_tier DEFAULT 'free',
  is_gfe BOOLEAN DEFAULT FALSE,
  gfe_terms_agreed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create firms table (for licensed investment firms)
CREATE TABLE public.firms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  firm_name TEXT NOT NULL,
  sector TEXT,
  country TEXT,
  license_number TEXT,
  license_document_url TEXT,
  contact_person_name TEXT,
  contact_person_title TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_address TEXT,
  logo_url TEXT,
  description TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create firm_staff table
CREATE TABLE public.firm_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID REFERENCES public.firms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT DEFAULT 'staff',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (firm_id, user_id)
);

-- Create wallets table
CREATE TABLE public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  user_wallet_balance DECIMAL(15,2) DEFAULT 0,
  gem_points INTEGER DEFAULT 0,
  gfe_wallet_balance DECIMAL(15,2) DEFAULT 0,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  bank_details_locked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create wallet_transactions table
CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE CASCADE NOT NULL,
  transaction_type TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  narration TEXT,
  source TEXT,
  status TEXT DEFAULT 'completed',
  actor_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create withdrawal_requests table
CREATE TABLE public.withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  wallet_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  processed_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create posts table
CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  category public.post_category NOT NULL,
  content TEXT NOT NULL,
  attachment_url TEXT,
  attachment_type TEXT,
  is_approved BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_hidden BOOLEAN DEFAULT FALSE,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create post_likes table
CREATE TABLE public.post_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (post_id, user_id)
);

-- Create post_comments table
CREATE TABLE public.post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  is_hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create post_shares table
CREATE TABLE public.post_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  platform TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create investment_opportunities table
CREATE TABLE public.investment_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID REFERENCES public.firms(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  minimum_amount DECIMAL(15,2),
  expected_roi DECIMAL(5,2),
  duration TEXT,
  payment_frequency TEXT,
  risk_level TEXT,
  documents_url TEXT[],
  media_url TEXT,
  sdg_tags TEXT[],
  status public.investment_status DEFAULT 'pending',
  admin_notes TEXT,
  views_count INTEGER DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_investments table
CREATE TABLE public.user_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  opportunity_id UUID REFERENCES public.investment_opportunities(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  status TEXT DEFAULT 'active',
  gains DECIMAL(15,2) DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create education_modules table
CREATE TABLE public.education_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  video_url TEXT,
  tier_required public.user_tier DEFAULT 'free',
  category TEXT,
  subcategory TEXT,
  order_index INTEGER DEFAULT 0,
  is_published BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create user_progress table
CREATE TABLE public.user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  module_id UUID REFERENCES public.education_modules(id) ON DELETE CASCADE NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  quiz_score INTEGER,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, module_id)
);

-- Create ai_search_logs table
CREATE TABLE public.ai_search_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  search_type TEXT NOT NULL,
  query TEXT NOT NULL,
  result TEXT,
  success BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create messages table
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  recipient_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_team TEXT,
  subject TEXT,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  parent_id UUID REFERENCES public.messages(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create complaints table
CREATE TABLE public.complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  issue_type TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  assigned_team TEXT,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create adverts table
CREATE TABLE public.adverts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  media_url TEXT,
  target_audience JSONB,
  channel TEXT NOT NULL,
  duration_hours INTEGER,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft',
  views_count INTEGER DEFAULT 0,
  clicks_count INTEGER DEFAULT 0,
  advertiser_id UUID REFERENCES auth.users(id),
  advertiser_name TEXT,
  advertiser_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create referral_stats table
CREATE TABLE public.referral_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  total_clicks INTEGER DEFAULT 0,
  total_signups INTEGER DEFAULT 0,
  total_verified INTEGER DEFAULT 0,
  total_subscribed INTEGER DEFAULT 0,
  total_investing INTEGER DEFAULT 0,
  total_earnings DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create system_settings table
CREATE TABLE public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create notifications table
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firm_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adverts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Create has_role function for RLS
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to generate referral code
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'INV' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
END;
$$;

-- Create handle_new_user function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    public.generate_referral_code()
  );
  
  INSERT INTO public.wallets (user_id)
  VALUES (NEW.id);
  
  INSERT INTO public.referral_stats (user_id)
  VALUES (NEW.id);
  
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$;

-- Create trigger for new users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Add updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_firms_updated_at BEFORE UPDATE ON public.firms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_investment_opportunities_updated_at BEFORE UPDATE ON public.investment_opportunities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update all profiles" ON public.profiles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Public profiles for community" ON public.profiles FOR SELECT USING (true);

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for wallets
CREATE POLICY "Users can view their own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own wallet" ON public.wallets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all wallets" ON public.wallets FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update all wallets" ON public.wallets FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for wallet_transactions
CREATE POLICY "Users can view their own transactions" ON public.wallet_transactions FOR SELECT USING (
  wallet_id IN (SELECT id FROM public.wallets WHERE user_id = auth.uid())
);
CREATE POLICY "Admins can view all transactions" ON public.wallet_transactions FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert transactions" ON public.wallet_transactions FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for posts
CREATE POLICY "Anyone can view approved posts" ON public.posts FOR SELECT USING (is_approved = true AND is_hidden = false);
CREATE POLICY "Users can view their own posts" ON public.posts FOR SELECT USING (auth.uid() = author_id);
CREATE POLICY "Users can create posts" ON public.posts FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Users can update their own posts" ON public.posts FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "Users can delete their own posts" ON public.posts FOR DELETE USING (auth.uid() = author_id);
CREATE POLICY "Admins can manage all posts" ON public.posts FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for post_likes
CREATE POLICY "Anyone can view likes" ON public.post_likes FOR SELECT USING (true);
CREATE POLICY "Users can like posts" ON public.post_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unlike posts" ON public.post_likes FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for post_comments
CREATE POLICY "Anyone can view comments" ON public.post_comments FOR SELECT USING (is_hidden = false);
CREATE POLICY "Users can create comments" ON public.post_comments FOR INSERT WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Users can update their own comments" ON public.post_comments FOR UPDATE USING (auth.uid() = author_id);
CREATE POLICY "Users can delete their own comments" ON public.post_comments FOR DELETE USING (auth.uid() = author_id);
CREATE POLICY "Admins can manage all comments" ON public.post_comments FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for post_shares
CREATE POLICY "Users can view their shares" ON public.post_shares FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can share posts" ON public.post_shares FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for groups
CREATE POLICY "Users can view their own groups" ON public.groups FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can create groups" ON public.groups FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own groups" ON public.groups FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Admins can manage all groups" ON public.groups FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for firms
CREATE POLICY "Users can view their own firms" ON public.firms FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can create firms" ON public.firms FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own firms" ON public.firms FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Admins can manage all firms" ON public.firms FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Public can view verified firms" ON public.firms FOR SELECT USING (is_verified = true);

-- RLS Policies for firm_staff
CREATE POLICY "Firm owners can manage staff" ON public.firm_staff FOR ALL USING (
  firm_id IN (SELECT id FROM public.firms WHERE owner_id = auth.uid())
);
CREATE POLICY "Staff can view their membership" ON public.firm_staff FOR SELECT USING (auth.uid() = user_id);

-- RLS Policies for investment_opportunities
CREATE POLICY "Anyone can view approved opportunities" ON public.investment_opportunities FOR SELECT USING (status = 'approved');
CREATE POLICY "Firm owners can manage their opportunities" ON public.investment_opportunities FOR ALL USING (
  firm_id IN (SELECT id FROM public.firms WHERE owner_id = auth.uid())
);
CREATE POLICY "Admins can manage all opportunities" ON public.investment_opportunities FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for user_investments
CREATE POLICY "Users can view their own investments" ON public.user_investments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create investments" ON public.user_investments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all investments" ON public.user_investments FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for education_modules
CREATE POLICY "Anyone can view published modules" ON public.education_modules FOR SELECT USING (is_published = true);
CREATE POLICY "Admins can manage modules" ON public.education_modules FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for user_progress
CREATE POLICY "Users can view their own progress" ON public.user_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own progress" ON public.user_progress FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update progress" ON public.user_progress FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for ai_search_logs
CREATE POLICY "Users can view their own logs" ON public.ai_search_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create logs" ON public.ai_search_logs FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Admins can view all logs" ON public.ai_search_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for messages
CREATE POLICY "Users can view their messages" ON public.messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY "Users can send messages" ON public.messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Admins can view all messages" ON public.messages FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for complaints
CREATE POLICY "Users can view their own complaints" ON public.complaints FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create complaints" ON public.complaints FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage all complaints" ON public.complaints FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for withdrawal_requests
CREATE POLICY "Users can view their own requests" ON public.withdrawal_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create requests" ON public.withdrawal_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can manage all requests" ON public.withdrawal_requests FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for adverts
CREATE POLICY "Anyone can view active adverts" ON public.adverts FOR SELECT USING (status = 'active');
CREATE POLICY "Admins can manage adverts" ON public.adverts FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for referral_stats
CREATE POLICY "Users can view their own stats" ON public.referral_stats FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all stats" ON public.referral_stats FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for system_settings
CREATE POLICY "Anyone can view settings" ON public.system_settings FOR SELECT USING (true);
CREATE POLICY "Admins can manage settings" ON public.system_settings FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for notifications
CREATE POLICY "Users can view their notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "System can create notifications" ON public.notifications FOR INSERT WITH CHECK (true);

-- Enable realtime for posts, comments, and notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.post_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Insert default system settings
INSERT INTO public.system_settings (key, value) VALUES
('onboarding_bonus', '{"amount": 2000, "currency": "NGN"}'),
('direct_subscriber_commission', '{"percentage": 30}'),
('direct_investor_commission', '{"percentage": 40}'),
('indirect_subscriber_commission', '{"percentage": 10}'),
('indirect_investor_commission', '{"percentage": 5}'),
('withdrawal_fee_free', '{"percentage": 15}'),
('withdrawal_fee_premium', '{"percentage": 10}'),
('withdrawal_fee_exclusive', '{"percentage": 5}'),
('minimum_withdrawal', '{"amount": 5000, "currency": "NGN"}'),
('tier_pricing', '{"premium": 10, "exclusive": 20, "currency": "USD"}');