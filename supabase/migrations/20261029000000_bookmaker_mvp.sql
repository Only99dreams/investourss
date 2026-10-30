-- ============================================================
-- Bookmaker by Investours — MVP
-- ------------------------------------------------------------
-- Adds:
--   * bookmaker_books              (draft / outline / chapters / cover / theme)
--   * bookmaker_credit_operations  (paid AI operations + idempotency + refunds)
--   * bookmaker_subscription_credits (included AI credits per subscription period)
--   * entitlement / reserve / complete / abandon / refund RPCs
--   * storage bucket for uploaded covers
--   * featured-solution seed
--
-- Credit schedule (server-authoritative):
--   Initial book / full regeneration: short 2, medium 4, long 6
--   Chapter / section regeneration:   1
--   Visual regeneration:              1
--   Cover generation / replacement:   1
--   Manual edits / PDF export:        0
--
-- Subscription included credits (per period):
--   monthly 3, quarterly 6, bi-annual 9, annual 15,
--   b2b quarterly 6, b2b annual 15
-- ============================================================

-- ============================================================
-- 1. Books
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bookmaker_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT,
  idea TEXT NOT NULL DEFAULT '',
  idea_input_mode TEXT NOT NULL DEFAULT 'text' CHECK (idea_input_mode IN ('text', 'voice')),
  audience TEXT NOT NULL DEFAULT 'general',
  custom_audience TEXT,
  purpose TEXT NOT NULL DEFAULT 'teach',
  custom_purpose TEXT,
  language TEXT NOT NULL DEFAULT 'English',
  custom_language TEXT,
  length TEXT NOT NULL DEFAULT 'medium' CHECK (length IN ('short', 'medium', 'long')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'configured', 'outline_ready', 'generating', 'manuscript_ready', 'designed', 'completed', 'failed')),
  outline JSONB NOT NULL DEFAULT '{"chapters":[]}'::jsonb,
  chapters JSONB NOT NULL DEFAULT '[]'::jsonb,
  cover JSONB NOT NULL DEFAULT '{}'::jsonb,
  theme JSONB NOT NULL DEFAULT '{}'::jsonb,
  design JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  credits_spent INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookmaker_books_user_updated
  ON public.bookmaker_books (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS update_bookmaker_books_updated_at ON public.bookmaker_books;
CREATE TRIGGER update_bookmaker_books_updated_at
  BEFORE UPDATE ON public.bookmaker_books
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. Paid AI operations (credit ledger + idempotency)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bookmaker_credit_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID REFERENCES public.bookmaker_books(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  credit_cost INTEGER NOT NULL DEFAULT 0,
  credits_from_subscription INTEGER NOT NULL DEFAULT 0,
  credits_from_packs INTEGER NOT NULL DEFAULT 0,
  subscription_grant_id UUID,
  pack_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  refunded_credits INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bookmaker_ops_user_created
  ON public.bookmaker_credit_operations (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmaker_ops_book
  ON public.bookmaker_credit_operations (book_id, created_at DESC);

-- A book may only have one reservation in flight. This is the hard stop that
-- prevents accidental double-clicks and parallel AI generation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmaker_ops_one_pending_per_book
  ON public.bookmaker_credit_operations (book_id)
  WHERE status = 'pending' AND book_id IS NOT NULL;

-- ============================================================
-- 3. Subscription included-credit periods
-- ============================================================
CREATE TABLE IF NOT EXISTS public.bookmaker_subscription_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_type TEXT NOT NULL DEFAULT 'monthly',
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  credits_granted INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_bookmaker_sub_credits_user
  ON public.bookmaker_subscription_credits (user_id, period_end DESC);

DROP TRIGGER IF EXISTS update_bookmaker_sub_credits_updated_at ON public.bookmaker_subscription_credits;
CREATE TRIGGER update_bookmaker_sub_credits_updated_at
  BEFORE UPDATE ON public.bookmaker_subscription_credits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE public.bookmaker_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmaker_credit_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmaker_subscription_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner manages own bookmaker books" ON public.bookmaker_books;
DROP POLICY IF EXISTS "Admins manage all bookmaker books" ON public.bookmaker_books;
CREATE POLICY "Owner manages own bookmaker books"
  ON public.bookmaker_books FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all bookmaker books"
  ON public.bookmaker_books FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Operations are written only by the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS "Owner reads own bookmaker operations" ON public.bookmaker_credit_operations;
DROP POLICY IF EXISTS "Admins read all bookmaker operations" ON public.bookmaker_credit_operations;
CREATE POLICY "Owner reads own bookmaker operations"
  ON public.bookmaker_credit_operations FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Admins read all bookmaker operations"
  ON public.bookmaker_credit_operations FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Owner reads own bookmaker subscription credits" ON public.bookmaker_subscription_credits;
DROP POLICY IF EXISTS "Admins read all bookmaker subscription credits" ON public.bookmaker_subscription_credits;
CREATE POLICY "Owner reads own bookmaker subscription credits"
  ON public.bookmaker_subscription_credits FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Admins read all bookmaker subscription credits"
  ON public.bookmaker_subscription_credits FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Members may edit their manuscript, but pricing/system fields stay
-- server-owned. Without this, a caller could relabel a 12-chapter outline as
-- "short" and under-pay for the manuscript.
REVOKE UPDATE ON public.bookmaker_books FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  title, subtitle, idea, idea_input_mode, audience, custom_audience,
  purpose, custom_purpose, language, custom_language,
  outline, chapters, cover, theme, design
) ON public.bookmaker_books TO authenticated;

-- ============================================================
-- 5. Cost schedule (server-authoritative)
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookmaker_operation_cost(
  p_operation TEXT,
  p_length TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_length TEXT := COALESCE(p_length, 'short');
BEGIN
  IF p_operation IN ('initial_book', 'full_regeneration') THEN
    RETURN CASE v_length
      WHEN 'short' THEN 2
      WHEN 'medium' THEN 4
      WHEN 'long' THEN 6
      ELSE 2
    END;
  ELSIF p_operation IN ('chapter_regeneration', 'visual_regeneration', 'cover_generation') THEN
    RETURN 1;
  ELSIF p_operation IN ('outline', 'export') THEN
    RETURN 0;
  END IF;
  RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_operation_cost(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_operation_cost(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookmaker_operation_cost(TEXT, TEXT) TO service_role;

-- ============================================================
-- 6. Subscription grant helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookmaker_ensure_subscription_grant(p_user_id UUID)
RETURNS public.bookmaker_subscription_credits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_active BOOLEAN;
  v_type TEXT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_granted INTEGER;
  v_grant public.bookmaker_subscription_credits;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_active :=
    (COALESCE(v_profile.has_active_subscription, FALSE)
      AND (v_profile.subscription_expires_at IS NULL OR v_profile.subscription_expires_at > now()))
    OR (v_profile.subscription_expires_at IS NOT NULL AND v_profile.subscription_expires_at > now())
    OR COALESCE(v_profile.user_tier, 'free') IN ('premium', 'exclusive');

  IF NOT v_active THEN
    RETURN NULL;
  END IF;

  v_type := COALESCE(v_profile.subscription_type, 'monthly');

  IF v_profile.subscription_expires_at IS NOT NULL AND v_profile.subscription_expires_at > now() THEN
    v_end := v_profile.subscription_expires_at;
    v_start := CASE v_type
      WHEN 'monthly' THEN v_end - INTERVAL '1 month'
      WHEN 'quarterly' THEN v_end - INTERVAL '3 months'
      WHEN 'biennial' THEN v_end - INTERVAL '6 months'
      WHEN 'annual' THEN v_end - INTERVAL '1 year'
      WHEN 'b2b_quarterly' THEN v_end - INTERVAL '3 months'
      WHEN 'b2b_annual' THEN v_end - INTERVAL '1 year'
      ELSE v_end - INTERVAL '1 month'
    END;
  ELSE
    -- Tier-based access without a stored expiry: use a rolling calendar month.
    v_start := date_trunc('month', now());
    v_end := date_trunc('month', now()) + INTERVAL '1 month';
    v_type := COALESCE(v_profile.subscription_type, 'monthly');
  END IF;

  v_granted := CASE v_type
    WHEN 'monthly' THEN 3
    WHEN 'quarterly' THEN 6
    WHEN 'biennial' THEN 9
    WHEN 'annual' THEN 15
    WHEN 'b2b_quarterly' THEN 6
    WHEN 'b2b_annual' THEN 15
    ELSE 3
  END;

  INSERT INTO public.bookmaker_subscription_credits
    (user_id, subscription_type, period_start, period_end, credits_granted)
  VALUES
    (p_user_id, v_type, v_start, v_end, v_granted)
  ON CONFLICT (user_id, period_start, period_end) DO UPDATE
    SET subscription_type = EXCLUDED.subscription_type,
        credits_granted = GREATEST(
          public.bookmaker_subscription_credits.credits_granted,
          EXCLUDED.credits_granted
        )
  RETURNING * INTO v_grant;

  RETURN v_grant;
END;
$$;

-- Internal helper only. Entitlement/reservation call it as SECURITY DEFINER, so
-- clients never need to pass another member's user id.
REVOKE ALL ON FUNCTION public.bookmaker_ensure_subscription_grant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_ensure_subscription_grant(UUID) TO service_role;

-- ============================================================
-- 7. Refund helper (internal; revoke from clients)
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookmaker_refund_operation_internal(
  p_operation_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_refund_override INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.bookmaker_credit_operations;
  v_refund INTEGER;
  v_remaining INTEGER;
  v_sub_refund INTEGER;
  v_item JSONB;
  v_pack UUID;
  v_amount INTEGER;
  v_pack_total INTEGER;
BEGIN
  SELECT * INTO v_op
  FROM public.bookmaker_credit_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND OR v_op.status <> 'pending' THEN
    RETURN 0;
  END IF;

  v_refund := COALESCE(p_refund_override, v_op.credit_cost);
  v_refund := GREATEST(0, LEAST(v_refund, v_op.credit_cost));
  v_remaining := v_refund;

  -- Subscription credits are always refunded first, mirroring the debit order.
  v_sub_refund := LEAST(v_remaining, COALESCE(v_op.credits_from_subscription, 0));
  IF v_sub_refund > 0 AND v_op.subscription_grant_id IS NOT NULL THEN
    UPDATE public.bookmaker_subscription_credits
    SET credits_used = GREATEST(credits_used - v_sub_refund, 0)
    WHERE id = v_op.subscription_grant_id;
    v_remaining := v_remaining - v_sub_refund;
  END IF;

  -- Then refund the exact packs that were debited.
  IF v_remaining > 0 THEN
    FOR v_item IN
      SELECT * FROM jsonb_array_elements(COALESCE(v_op.pack_breakdown, '[]'::jsonb))
    LOOP
      EXIT WHEN v_remaining <= 0;
      BEGIN
        v_pack := (v_item->>'pack_id')::UUID;
      EXCEPTION WHEN OTHERS THEN
        v_pack := NULL;
      END;
      v_amount := COALESCE((v_item->>'amount')::INTEGER, 0);
      IF v_pack IS NOT NULL AND v_amount > 0 THEN
        v_amount := LEAST(v_amount, v_remaining);
        UPDATE public.user_credit_packs
        SET credits_remaining = credits_remaining + v_amount
        WHERE id = v_pack;
        v_remaining := v_remaining - v_amount;
      END IF;
    END LOOP;
  END IF;

  -- Legacy/partial breakdown fallback: keep value on the user's oldest pack.
  IF v_remaining > 0 THEN
    UPDATE public.user_credit_packs
    SET credits_remaining = credits_remaining + v_remaining
    WHERE id = (
      SELECT id FROM public.user_credit_packs
      WHERE user_id = v_op.user_id
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at ASC NULLS LAST
      LIMIT 1
    );
  END IF;

  SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER INTO v_pack_total
  FROM public.user_credit_packs
  WHERE user_id = v_op.user_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
  SET audit_credits = v_pack_total, updated_at = now()
  WHERE id = v_op.user_id;

  UPDATE public.bookmaker_credit_operations
  SET status = 'failed',
      error = COALESCE(p_reason, error),
      refunded_credits = v_refund,
      completed_at = now()
  WHERE id = v_op.id;

  -- Keep the member-facing "credits used" figure equal to net spend. Without
  -- this, an abandoned or failed reservation would look as though the refunded
  -- credits had still been consumed.
  IF v_op.book_id IS NOT NULL AND v_refund > 0 THEN
    UPDATE public.bookmaker_books
    SET credits_spent = GREATEST(credits_spent - v_refund, 0),
        updated_at = now()
    WHERE id = v_op.book_id
      AND user_id = v_op.user_id;
  END IF;

  RETURN v_refund;
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_refund_operation_internal(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_refund_operation_internal(UUID, TEXT, INTEGER) TO service_role;

-- ============================================================
-- 8. Entitlement (balance + schedule)
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookmaker_get_entitlement()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_grant public.bookmaker_subscription_credits;
  v_sub_remaining INTEGER := 0;
  v_pack_total INTEGER := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', FALSE,
      'subscription_active', FALSE,
      'subscription_credits_remaining', 0,
      'pack_credits_remaining', 0,
      'total_available', 0
    );
  END IF;

  v_grant := public.bookmaker_ensure_subscription_grant(v_user);

  IF v_grant.id IS NOT NULL THEN
    v_sub_remaining := GREATEST(v_grant.credits_granted - v_grant.credits_used, 0);
  END IF;

  SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER INTO v_pack_total
  FROM public.user_credit_packs
  WHERE user_id = v_user
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  RETURN jsonb_build_object(
    'authenticated', TRUE,
    'subscription_active', v_grant.id IS NOT NULL,
    'subscription_type', v_grant.subscription_type,
    'subscription_credits_remaining', v_sub_remaining,
    'subscription_credits_granted', COALESCE(v_grant.credits_granted, 0),
    'subscription_credits_used', COALESCE(v_grant.credits_used, 0),
    'subscription_period_end', v_grant.period_end,
    'pack_credits_remaining', v_pack_total,
    'total_available', v_sub_remaining + v_pack_total,
    'costs', jsonb_build_object(
      'short', 2,
      'medium', 4,
      'long', 6,
      'chapter_regeneration', 1,
      'visual_regeneration', 1,
      'cover_generation', 1,
      'full_regeneration_short', 2,
      'full_regeneration_medium', 4,
      'full_regeneration_long', 6
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_get_entitlement() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_get_entitlement() TO authenticated;

-- ============================================================
-- 9. Reserve credits for an AI operation
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookmaker_reserve_operation(
  p_book_id UUID,
  p_operation TEXT,
  p_idempotency_key TEXT,
  p_length TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_book public.bookmaker_books;
  v_existing public.bookmaker_credit_operations;
  v_grant public.bookmaker_subscription_credits;
  v_pack RECORD;
  v_stale RECORD;
  v_cost INTEGER;
  v_sub_available INTEGER := 0;
  v_pack_available INTEGER := 0;
  v_available INTEGER := 0;
  v_sub_debit INTEGER := 0;
  v_pack_debit INTEGER := 0;
  v_pack_left INTEGER := 0;
  v_pack_breakdown JSONB := '[]'::jsonb;
  v_profile_total INTEGER := 0;
  v_metadata JSONB := COALESCE(p_metadata, '{}'::jsonb);
  v_op public.bookmaker_credit_operations;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'unauthenticated', 'message', 'Please sign in.');
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'invalid_key', 'message', 'A valid request key is required.');
  END IF;

  IF p_book_id IS NOT NULL THEN
    SELECT * INTO v_book
    FROM public.bookmaker_books
    WHERE id = p_book_id AND user_id = v_user;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', FALSE, 'reason', 'book_not_found', 'message', 'Book not found.');
    END IF;
  END IF;

  -- Release reservations abandoned for more than 90 minutes. This is a
  -- safeguard, not a cron: the next paid action cleans up anything stale.
  FOR v_stale IN
    SELECT id FROM public.bookmaker_credit_operations
    WHERE user_id = v_user
      AND status = 'pending'
      AND created_at < now() - INTERVAL '90 minutes'
  LOOP
    PERFORM public.bookmaker_refund_operation_internal(v_stale.id, 'Reservation expired');
  END LOOP;

  -- Idempotency: the same client key never charges twice.
  SELECT * INTO v_existing
  FROM public.bookmaker_credit_operations
  WHERE user_id = v_user AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', v_existing.status <> 'failed',
      'reason', CASE WHEN v_existing.status = 'failed' THEN 'operation_failed' ELSE 'duplicate' END,
      'message', CASE WHEN v_existing.status = 'failed' THEN COALESCE(v_existing.error, 'This operation failed.') ELSE 'This request was already processed.' END,
      'duplicate', TRUE,
      'operation_id', v_existing.id,
      'cost', v_existing.credit_cost,
      'status', v_existing.status,
      'entitlement', public.bookmaker_get_entitlement()
    );
  END IF;

  -- One in-flight paid operation per book.
  IF p_book_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.bookmaker_credit_operations
    WHERE user_id = v_user
      AND book_id = p_book_id
      AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', TRUE,
        'duplicate', TRUE,
        'operation_id', v_existing.id,
        'cost', v_existing.credit_cost,
        'entitlement', public.bookmaker_get_entitlement(),
        'message', 'A generation is already in progress for this book.'
      );
    END IF;
  END IF;

  v_cost := public.bookmaker_operation_cost(
    p_operation,
    CASE
      WHEN p_operation IN ('initial_book', 'full_regeneration') AND p_book_id IS NOT NULL
        THEN COALESCE(v_book.length, p_length)
      ELSE p_length
    END
  );

  -- Pin the manuscript shape at reservation time. A book cannot be made
  -- cheaper by editing its length after credits have been reserved.
  IF p_operation IN ('initial_book', 'full_regeneration') AND p_book_id IS NOT NULL THEN
    v_metadata := jsonb_set(
      v_metadata,
      '{length}',
      to_jsonb(v_book.length)
    );
    v_metadata := jsonb_set(
      v_metadata,
      '{total_chapters}',
      to_jsonb(
        GREATEST(
          jsonb_array_length(COALESCE(v_book.outline->'chapters', '[]'::jsonb)),
          1
        )
      )
    );
  END IF;

  -- Free operations still get an auditable row, but no balance check.
  IF v_cost = 0 THEN
    INSERT INTO public.bookmaker_credit_operations
      (user_id, book_id, operation, idempotency_key, credit_cost, status, metadata)
    VALUES
      (v_user, p_book_id, p_operation, p_idempotency_key, 0, 'pending', v_metadata)
    RETURNING * INTO v_op;

    RETURN jsonb_build_object(
      'success', TRUE,
      'operation_id', v_op.id,
      'cost', 0,
      'duplicate', FALSE,
      'entitlement', public.bookmaker_get_entitlement()
    );
  END IF;

  -- Lock the current subscription grant.
  v_grant := public.bookmaker_ensure_subscription_grant(v_user);
  IF v_grant.id IS NOT NULL THEN
    SELECT * INTO v_grant
    FROM public.bookmaker_subscription_credits
    WHERE id = v_grant.id
    FOR UPDATE;
    v_sub_available := GREATEST(v_grant.credits_granted - v_grant.credits_used, 0);
  END IF;

  -- Lock packs and total the unexpired balance.
  FOR v_pack IN
    SELECT * FROM public.user_credit_packs
    WHERE user_id = v_user
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY expires_at ASC NULLS LAST
    FOR UPDATE
  LOOP
    v_pack_available := v_pack_available + GREATEST(v_pack.credits_remaining, 0);
  END LOOP;

  v_available := v_sub_available + v_pack_available;

  IF v_cost > v_available THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'reason', 'insufficient_credits',
      'message', 'You do not have enough AI credits for this operation.',
      'cost', v_cost,
      'available', v_available,
      'shortfall', v_cost - v_available,
      'entitlement', public.bookmaker_get_entitlement()
    );
  END IF;

  -- Debit subscription included credits first.
  v_sub_debit := LEAST(v_cost, v_sub_available);
  IF v_sub_debit > 0 THEN
    UPDATE public.bookmaker_subscription_credits
    SET credits_used = credits_used + v_sub_debit
    WHERE id = v_grant.id;
  END IF;

  -- Then debit credit packs, oldest expiry first.
  v_pack_left := v_cost - v_sub_debit;
  IF v_pack_left > 0 THEN
    FOR v_pack IN
      SELECT * FROM public.user_credit_packs
      WHERE user_id = v_user
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
        AND credits_remaining > 0
      ORDER BY expires_at ASC NULLS LAST
      FOR UPDATE
    LOOP
      EXIT WHEN v_pack_left <= 0;
      v_pack_debit := LEAST(v_pack.credits_remaining, v_pack_left);
      IF v_pack_debit > 0 THEN
        UPDATE public.user_credit_packs
        SET credits_remaining = credits_remaining - v_pack_debit
        WHERE id = v_pack.id;

        v_pack_breakdown := v_pack_breakdown || jsonb_build_array(
          jsonb_build_object('pack_id', v_pack.id, 'amount', v_pack_debit)
        );
        v_pack_left := v_pack_left - v_pack_debit;
      END IF;
    END LOOP;
  END IF;

  -- Recompute the mirrored profile balance from the packs (source of truth).
  SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER INTO v_profile_total
  FROM public.user_credit_packs
  WHERE user_id = v_user
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
  SET audit_credits = v_profile_total, updated_at = now()
  WHERE id = v_user;

  INSERT INTO public.bookmaker_credit_operations
    (user_id, book_id, operation, idempotency_key, credit_cost,
     credits_from_subscription, credits_from_packs, subscription_grant_id,
     pack_breakdown, status, metadata)
  VALUES
    (v_user, p_book_id, p_operation, p_idempotency_key, v_cost,
     v_sub_debit, v_cost - v_sub_debit, v_grant.id,
     v_pack_breakdown, 'pending', v_metadata)
  RETURNING * INTO v_op;

  IF p_book_id IS NOT NULL THEN
    UPDATE public.bookmaker_books
    SET credits_spent = credits_spent + v_cost,
        updated_at = now()
    WHERE id = p_book_id AND user_id = v_user;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'operation_id', v_op.id,
    'cost', v_cost,
    'credits_from_subscription', v_sub_debit,
    'credits_from_packs', v_cost - v_sub_debit,
    'duplicate', FALSE,
    'entitlement', public.bookmaker_get_entitlement()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_reserve_operation(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_reserve_operation(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ============================================================
-- 10. Complete / abandon / fail
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookmaker_complete_operation(p_operation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_op public.bookmaker_credit_operations;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Please sign in.');
  END IF;

  UPDATE public.bookmaker_credit_operations
  SET status = 'completed', completed_at = now()
  WHERE id = p_operation_id
    AND user_id = v_user
    AND status = 'pending'
  RETURNING * INTO v_op;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Operation not found or already settled.');
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'operation_id', v_op.id,
    'entitlement', public.bookmaker_get_entitlement()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_complete_operation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_complete_operation(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.bookmaker_abandon_operation(
  p_operation_id UUID,
  p_reason TEXT DEFAULT 'Cancelled by user'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_op public.bookmaker_credit_operations;
  v_total INTEGER;
  v_generated INTEGER;
  v_refund INTEGER;
  v_refunded INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Please sign in.');
  END IF;

  SELECT * INTO v_op
  FROM public.bookmaker_credit_operations
  WHERE id = p_operation_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND OR v_op.status <> 'pending' THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Operation not found or already settled.');
  END IF;

  v_total := CASE
    WHEN jsonb_typeof(v_op.metadata->'generate_chapters') = 'array'
      THEN GREATEST(jsonb_array_length(v_op.metadata->'generate_chapters'), 1)
    ELSE GREATEST(COALESCE((v_op.metadata->>'total_chapters')::INTEGER, 1), 1)
  END;
  v_generated := CASE
    WHEN jsonb_typeof(v_op.metadata->'generated_chapters') = 'array'
      THEN jsonb_array_length(v_op.metadata->'generated_chapters')
    ELSE 0
  END;

  IF v_op.operation IN ('initial_book', 'full_regeneration') THEN
    v_refund := floor(v_op.credit_cost::NUMERIC * (v_total - v_generated) / v_total)::INTEGER;
  ELSE
    v_refund := CASE WHEN v_generated > 0 THEN 0 ELSE v_op.credit_cost END;
  END IF;

  v_refund := GREATEST(0, LEAST(v_refund, v_op.credit_cost));
  v_refunded := public.bookmaker_refund_operation_internal(p_operation_id, p_reason, v_refund);

  RETURN jsonb_build_object(
    'success', TRUE,
    'refunded', v_refunded,
    'message', CASE WHEN v_refunded > 0 THEN 'Unused credits refunded.' ELSE 'No credits were refundable for this operation.' END,
    'entitlement', public.bookmaker_get_entitlement()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_abandon_operation(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_abandon_operation(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.bookmaker_fail_operation(
  p_operation_id UUID,
  p_reason TEXT DEFAULT 'AI generation failed'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.bookmaker_refund_operation_internal(p_operation_id, p_reason, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_fail_operation(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_fail_operation(UUID, TEXT) TO service_role;

-- ============================================================
-- 11. Chapter progress (server-side, prevents refund abuse)
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookmaker_record_chapter_progress(
  p_operation_id UUID,
  p_chapter_number INTEGER,
  p_total_chapters INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op public.bookmaker_credit_operations;
  v_generated JSONB;
  v_total INTEGER;
BEGIN
  SELECT * INTO v_op
  FROM public.bookmaker_credit_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'message', 'Operation not found.');
  END IF;

  v_total := GREATEST(COALESCE(p_total_chapters, (v_op.metadata->>'total_chapters')::INTEGER, 1), 1);
  v_generated := CASE
    WHEN jsonb_typeof(v_op.metadata->'generated_chapters') = 'array'
      THEN v_op.metadata->'generated_chapters'
    ELSE '[]'::jsonb
  END;

  IF NOT (v_generated @> to_jsonb(p_chapter_number)) THEN
    v_generated := v_generated || jsonb_build_array(p_chapter_number);
  END IF;

  UPDATE public.bookmaker_credit_operations
  SET metadata = jsonb_set(
        jsonb_set(COALESCE(metadata, '{}'::jsonb), '{total_chapters}', to_jsonb(v_total)),
        '{generated_chapters}', v_generated
      )
  WHERE id = p_operation_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'generated_chapters', v_generated,
    'total_chapters', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_record_chapter_progress(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_record_chapter_progress(UUID, INTEGER, INTEGER) TO service_role;

-- ============================================================
-- 12. Storage bucket for uploaded covers
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bookmaker-covers',
  'bookmaker-covers',
  TRUE,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Bookmaker covers are publicly readable" ON storage.objects;
CREATE POLICY "Bookmaker covers are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'bookmaker-covers');

DROP POLICY IF EXISTS "Users upload own bookmaker covers" ON storage.objects;
CREATE POLICY "Users upload own bookmaker covers"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'bookmaker-covers'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "Users update own bookmaker covers" ON storage.objects;
CREATE POLICY "Users update own bookmaker covers"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'bookmaker-covers'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  )
  WITH CHECK (
    bucket_id = 'bookmaker-covers'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "Users delete own bookmaker covers" ON storage.objects;
CREATE POLICY "Users delete own bookmaker covers"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'bookmaker-covers'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- ============================================================
-- 13. Featured solution seed
-- ============================================================
INSERT INTO public.featured_solutions (key, title, description, path, icon, badge, sort_order)
VALUES (
  'bookmaker',
  'Bookmaker by Investours',
  'Turn your knowledge into a professionally designed ebook in minutes with AI.',
  '/bookmaker',
  'BookOpen',
  'NEW',
  0
)
ON CONFLICT (key) DO UPDATE
  SET title = EXCLUDED.title,
      description = EXCLUDED.description,
      path = EXCLUDED.path,
      icon = EXCLUDED.icon,
      badge = EXCLUDED.badge,
      sort_order = EXCLUDED.sort_order,
      is_active = TRUE;
