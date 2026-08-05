-- ============================================================
-- AI Financial Auditor — schema, RLS, RPCs and seed data
-- Implements the Version 1.0 MVP per the product brief:
--   * Financial Data Connection (sms / email / pdf / open_banking)
--   * FREE 6-month Financial Audit (one per account)
--   * Financial Health Dashboard + Score + Timeline + Audit History
--   * Blurred free report (detailed breakdown locked)
--   * Audit Credit Packs (pay-as-you-go) + Platform Subscription
--   * Weekly / Monthly Monitoring reports
--   * Configurable homepage featured solutions
-- ============================================================

-- ============================================================
-- 1. Financial data sources (SMS, Email, PDF, Open Banking)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('sms', 'email', 'pdf', 'open_banking')),
  display_name TEXT,
  content_text TEXT,
  file_url TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'processing', 'failed', 'disconnected')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_data_sources_user_id ON public.financial_data_sources (user_id);

-- ============================================================
-- 2. Financial audits (one row per audit run)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_id UUID REFERENCES public.financial_data_sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('processing', 'completed', 'failed')),
  health_score INTEGER NOT NULL DEFAULT 0 CHECK (health_score BETWEEN 0 AND 100),
  health_status TEXT NOT NULL DEFAULT 'critical' CHECK (health_status IN ('excellent', 'good', 'needs_attention', 'critical')),
  total_income NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_expenses NUMERIC(15,2) NOT NULL DEFAULT 0,
  cash_flow NUMERIC(15,2) NOT NULL DEFAULT 0,
  savings_rate NUMERIC(8,2) NOT NULL DEFAULT 0,
  recoverable_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  is_free BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked BOOLEAN NOT NULL DEFAULT TRUE,
  audit_period_start DATE,
  audit_period_end DATE,
  report_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_audits_user_id ON public.financial_audits (user_id);
CREATE INDEX IF NOT EXISTS idx_financial_audits_created_at ON public.financial_audits (created_at DESC);

-- ============================================================
-- 3. Recoverable transactions (leakages / bank overcharges)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recoverable_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  audit_id UUID REFERENCES public.financial_audits(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  transaction_date DATE,
  status TEXT NOT NULL DEFAULT 'identified' CHECK (status IN ('identified', 'submitted', 'recovered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recoverable_transactions_audit_id ON public.recoverable_transactions (audit_id);
CREATE INDEX IF NOT EXISTS idx_recoverable_transactions_user_id ON public.recoverable_transactions (user_id);

-- ============================================================
-- 4. Recovery recommendations (AI recommendations per audit)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recovery_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  audit_id UUID REFERENCES public.financial_audits(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'leakage' CHECK (category IN ('leakage', 'recovery', 'monitoring', 'spending')),
  is_locked BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_recommendations_audit_id ON public.recovery_recommendations (audit_id);

-- ============================================================
-- 5. Financial health timeline (monthly score snapshots)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  snapshot_date DATE NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  source TEXT NOT NULL DEFAULT 'audit' CHECK (source IN ('audit', 'monitoring')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_financial_health_snapshots_user_id ON public.financial_health_snapshots (user_id, snapshot_date);

-- ============================================================
-- 6. Audit credit packs (product catalogue)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_credit_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  credits INTEGER NOT NULL DEFAULT 0,
  price NUMERIC(15,2) NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. User audit pack orders (purchased / pending packs)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_credit_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pack_id UUID REFERENCES public.audit_credit_packs(id) ON DELETE SET NULL,
  pack_name TEXT NOT NULL,
  credits INTEGER NOT NULL DEFAULT 0,
  credits_remaining INTEGER NOT NULL DEFAULT 0,
  amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  activated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_credit_packs_user_id ON public.user_credit_packs (user_id);
CREATE INDEX IF NOT EXISTS idx_user_credit_packs_status ON public.user_credit_packs (status);

-- ============================================================
-- 8. Monitoring reports (weekly / monthly summaries)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.monitoring_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('weekly', 'monthly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  score INTEGER,
  content JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_reports_user_id ON public.monitoring_reports (user_id, report_type, created_at DESC);

-- ============================================================
-- 9. Homepage featured solutions (configurable, reorderable)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.featured_solutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  path TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'Sparkles',
  badge TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_featured_solutions_updated_at ON public.featured_solutions;
CREATE TRIGGER update_featured_solutions_updated_at BEFORE UPDATE ON public.featured_solutions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_audit_credit_packs_updated_at ON public.audit_credit_packs;
CREATE TRIGGER update_audit_credit_packs_updated_at BEFORE UPDATE ON public.audit_credit_packs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 10. Row Level Security
-- ============================================================
ALTER TABLE public.financial_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recoverable_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_credit_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credit_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.featured_solutions ENABLE ROW LEVEL SECURITY;

-- Owner rows are managed by their owner; admins manage everything.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'financial_data_sources',
    'financial_audits',
    'recoverable_transactions',
    'recovery_recommendations',
    'financial_health_snapshots',
    'monitoring_reports'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Owner manages own %s" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins manage all %s" ON public.%I', t, t);
    EXECUTE format('
      CREATE POLICY "Owner manages own %s" ON public.%I
        FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
      CREATE POLICY "Admins manage all %s" ON public.%I
        FOR ALL USING (public.has_role(auth.uid(), ''admin''::public.app_role))
        WITH CHECK (public.has_role(auth.uid(), ''admin''::public.app_role));', t, t, t, t);
  END LOOP;
END $$;

-- Audit credit packs: anyone can read active packs; admins manage.
DROP POLICY IF EXISTS "Anyone can read active audit packs" ON public.audit_credit_packs;
DROP POLICY IF EXISTS "Admins manage audit packs" ON public.audit_credit_packs;
CREATE POLICY "Anyone can read active audit packs"
  ON public.audit_credit_packs FOR SELECT
  USING (is_active = TRUE);
CREATE POLICY "Admins manage audit packs"
  ON public.audit_credit_packs FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- User credit packs: owner can read own; admins manage all.
DROP POLICY IF EXISTS "Owner reads own credit packs" ON public.user_credit_packs;
DROP POLICY IF EXISTS "Admins manage credit packs" ON public.user_credit_packs;
CREATE POLICY "Owner reads own credit packs"
  ON public.user_credit_packs FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Admins manage credit packs"
  ON public.user_credit_packs FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Featured solutions: anyone can read; admins manage.
DROP POLICY IF EXISTS "Anyone can read featured solutions" ON public.featured_solutions;
DROP POLICY IF EXISTS "Admins manage featured solutions" ON public.featured_solutions;
CREATE POLICY "Anyone can read featured solutions"
  ON public.featured_solutions FOR SELECT
  USING (is_active = TRUE);
CREATE POLICY "Admins manage featured solutions"
  ON public.featured_solutions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 11. RPC: check what audit access a user has
--     Returns free_audit_used, subscription_active and the
--     effective (unexpired) credit balance.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_audit_access(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  can_audit BOOLEAN,
  access_type TEXT,
  free_audit_used BOOLEAN,
  subscription_active BOOLEAN,
  credits_remaining INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_sub BOOLEAN;
  v_free_used BOOLEAN;
  v_credits INTEGER;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'none', FALSE, FALSE, 0;
    RETURN;
  END IF;

  SELECT COALESCE(has_active_subscription, FALSE) INTO v_sub
  FROM profiles WHERE id = v_user_id;

  SELECT EXISTS (
    SELECT 1 FROM financial_audits WHERE user_id = v_user_id AND is_free = TRUE
  ) INTO v_free_used;

  SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER INTO v_credits
  FROM user_credit_packs
  WHERE user_id = v_user_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  RETURN QUERY
    SELECT (v_sub OR NOT v_free_used OR v_credits > 0) AS can_audit,
           CASE
             WHEN v_sub THEN 'subscription'
             WHEN NOT v_free_used THEN 'free'
             WHEN v_credits > 0 THEN 'credits'
             ELSE 'none'
           END AS access_type,
           v_free_used AS free_audit_used,
           v_sub AS subscription_active,
           v_credits AS credits_remaining;
END;
$$;

REVOKE ALL ON FUNCTION public.get_audit_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_audit_access(UUID) TO authenticated;

-- ============================================================
-- 12. RPC: consume one audit credit (manual audits only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.consume_audit_credit(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_credits INTEGER;
  v_remaining INTEGER;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  SELECT COALESCE(audit_credits, 0) INTO v_credits FROM profiles WHERE id = v_user_id;
  IF v_credits <= 0 THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'No audit credits available.', 'credits_remaining', 0);
  END IF;

  v_remaining := v_credits - 1;

  UPDATE profiles
  SET audit_credits = v_remaining, updated_at = now()
  WHERE id = v_user_id;

  -- Keep the oldest active unexpired pack in sync so balances never diverge.
  UPDATE user_credit_packs
  SET credits_remaining = GREATEST(credits_remaining - 1, 0)
  WHERE id = (
    SELECT id FROM user_credit_packs
    WHERE user_id = v_user_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
      AND credits_remaining > 0
    ORDER BY expires_at ASC NULLS LAST
    LIMIT 1
  );

  RETURN jsonb_build_object('success', TRUE, 'credits_remaining', v_remaining);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_audit_credit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_audit_credit(UUID) TO authenticated;

-- ============================================================
-- 13. RPC: purchase an audit credit pack (creates pending order)
-- ============================================================
CREATE OR REPLACE FUNCTION public.purchase_audit_pack(p_pack_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_pack RECORD;
  v_ref TEXT;
  v_order_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Not authenticated.');
  END IF;

  SELECT name, credits, price, validity_days INTO v_pack
  FROM audit_credit_packs
  WHERE id = p_pack_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Audit credit pack not found or inactive.');
  END IF;

  v_ref := 'AC-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 10));

  INSERT INTO user_credit_packs (user_id, pack_id, pack_name, credits, amount, reference, status)
  VALUES (v_user_id, p_pack_id, v_pack.name, v_pack.credits, v_pack.price, v_ref, 'pending')
  RETURNING id INTO v_order_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'order_id', v_order_id,
    'reference', v_ref,
    'pack_name', v_pack.name,
    'amount', v_pack.price,
    'credits', v_pack.credits,
    'validity_days', v_pack.validity_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purchase_audit_pack(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_audit_pack(UUID) TO authenticated;

-- ============================================================
-- 14. RPC: admin activates a pending pack order, crediting the user
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_user_audit_pack(p_order_id UUID, p_admin_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_validity INTEGER;
  v_expiry TIMESTAMPTZ;
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin privileges required';
  END IF;

  SELECT * INTO v_order FROM user_credit_packs WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status = 'active' THEN
    RETURN TRUE;
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Order is not pending';
  END IF;

  SELECT validity_days INTO v_validity
  FROM audit_credit_packs WHERE id = v_order.pack_id;
  v_validity := COALESCE(v_validity, 30);

  v_expiry := now() + (v_validity || ' days')::INTERVAL;

  UPDATE user_credit_packs
  SET status = 'active',
      credits_remaining = v_order.credits,
      expires_at = v_expiry,
      activated_at = now(),
      activated_by = p_admin_id
  WHERE id = p_order_id;

  UPDATE profiles
  SET audit_credits = COALESCE(audit_credits, 0) + v_order.credits,
      updated_at = now()
  WHERE id = v_order.user_id;

  INSERT INTO notifications (user_id, title, message, type)
  VALUES (
    v_order.user_id,
    'Audit Credits Added!',
    'Your ' || v_order.pack_name || ' (' || v_order.credits || ' audit credits) has been activated.',
    'audit_credits_added'
  );

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_user_audit_pack(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_user_audit_pack(UUID, UUID) TO authenticated;

-- ============================================================
-- 15. Seed data
-- ============================================================
INSERT INTO public.audit_credit_packs (name, description, credits, price, validity_days, sort_order)
VALUES
  ('Starter Audit Pack', '2 Audit Credits · Valid 30 Days', 2, 1700, 30, 1),
  ('Standard Audit Pack', '8 Audit Credits · Valid 90 Days', 8, 6800, 90, 2),
  ('Annual Audit Pack', '32 Audit Credits · Valid 360 Days', 32, 27200, 360, 3)
ON CONFLICT DO NOTHING;

INSERT INTO public.featured_solutions (key, title, description, path, icon, badge, sort_order)
VALUES
  ('ai_business_plan', 'AI Business Plan Generator', 'Generate business plans, financial projections & funding readiness reports', '/business-plan', 'FileText', NULL, 1),
  ('ai_financial_auditor', 'AI Financial Auditor', 'Audit your finances, detect leakages and recover lost money', '/auditor', 'ScanSearch', 'NEW', 2)
ON CONFLICT (key) DO NOTHING;
