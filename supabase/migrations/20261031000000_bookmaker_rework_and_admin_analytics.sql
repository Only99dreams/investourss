-- ============================================================
-- Bookmaker — full rework, AI usage costs, admin analytics
-- ============================================================
-- 1. `full_rework` regenerates the whole manuscript from the saved outline,
--    ignores approvals and consumes one plan allowance slot plus credits.
-- 2. Every paid operation now records the actual AI usage (tokens, narration
--    characters and the USD cost of those calls).
-- 3. `bookmaker_admin_analytics` powers the admin dashboard. It is admin-only
--    and reads successful payments + generation outcomes from the database.

-- ============================================================
-- 1. AI usage columns
-- ============================================================
ALTER TABLE public.bookmaker_credit_operations
  ADD COLUMN IF NOT EXISTS ai_input_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_output_tokens BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_audio_characters BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bookmaker_ops_created
  ON public.bookmaker_credit_operations (created_at DESC);

-- Service-role only: the edge function is the only writer of real API usage.
CREATE OR REPLACE FUNCTION public.bookmaker_record_ai_usage(
  p_operation_id UUID,
  p_input_tokens BIGINT DEFAULT 0,
  p_output_tokens BIGINT DEFAULT 0,
  p_audio_characters BIGINT DEFAULT 0,
  p_cost_usd NUMERIC DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_operation_id IS NULL THEN
    RETURN FALSE;
  END IF;
  IF COALESCE(p_input_tokens, 0) < 0
     OR COALESCE(p_output_tokens, 0) < 0
     OR COALESCE(p_audio_characters, 0) < 0
     OR COALESCE(p_cost_usd, 0) < 0 THEN
    RAISE EXCEPTION 'AI usage values cannot be negative';
  END IF;

  UPDATE public.bookmaker_credit_operations
  SET ai_input_tokens = ai_input_tokens + COALESCE(p_input_tokens, 0),
      ai_output_tokens = ai_output_tokens + COALESCE(p_output_tokens, 0),
      ai_audio_characters = ai_audio_characters + COALESCE(p_audio_characters, 0),
      ai_cost_usd = ai_cost_usd + COALESCE(p_cost_usd, 0)
  WHERE id = p_operation_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_record_ai_usage(UUID, BIGINT, BIGINT, BIGINT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_record_ai_usage(UUID, BIGINT, BIGINT, BIGINT, NUMERIC) TO service_role;

-- ============================================================
-- 2. Rework costs the same as writing the book from scratch
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
  IF p_operation IN ('initial_book', 'full_regeneration', 'full_rework') THEN
    RETURN CASE v_length
      WHEN 'short' THEN 2
      WHEN 'medium' THEN 4
      WHEN 'long' THEN 6
      ELSE 2
    END;
  ELSIF p_operation = 'audiobook' THEN
    RETURN CASE v_length
      WHEN 'short' THEN 4
      WHEN 'medium' THEN 8
      WHEN 'long' THEN 12
      ELSE 8
    END;
  ELSIF p_operation IN ('chapter_regeneration', 'visual_regeneration', 'cover_generation', 'book_download') THEN
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
-- 3. Entitlement (rework counts against the plan allowance)
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
  v_items_limit INTEGER := NULL;
  v_items_used INTEGER := 0;
  v_download_limit INTEGER := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', FALSE,
      'subscription_active', FALSE,
      'subscription_credits_remaining', 0,
      'pack_credits_remaining', 0,
      'total_available', 0,
      'download_limit', 0,
      'download_cost', 1,
      'audiobook_pack_only', TRUE
    );
  END IF;

  v_grant := public.bookmaker_ensure_subscription_grant(v_user);

  IF v_grant.id IS NOT NULL THEN
    v_sub_remaining := GREATEST(v_grant.credits_granted - v_grant.credits_used, 0);
    v_items_limit := public.bookmaker_plan_item_limit(v_grant.subscription_type);

    -- A book written from scratch and a full rework both use one slot.
    -- Narration is pack-paid and intentionally excluded.
    SELECT COUNT(*) INTO v_items_used
    FROM public.bookmaker_credit_operations
    WHERE user_id = v_user
      AND operation IN ('initial_book', 'full_rework')
      AND status IN ('pending', 'completed')
      AND created_at >= v_grant.period_start
      AND created_at < v_grant.period_end;
  END IF;

  SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER INTO v_pack_total
  FROM public.user_credit_packs
  WHERE user_id = v_user
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  v_download_limit := public.bookmaker_download_limit_for_user(v_user);

  RETURN jsonb_build_object(
    'authenticated', TRUE,
    'subscription_active', v_grant.id IS NOT NULL,
    'subscription_type', v_grant.subscription_type,
    'subscription_credits_remaining', v_sub_remaining,
    'subscription_credits_granted', COALESCE(v_grant.credits_granted, 0),
    'subscription_credits_used', COALESCE(v_grant.credits_used, 0),
    'subscription_period_end', v_grant.period_end,
    'plan_items_limit', v_items_limit,
    'plan_items_used', v_items_used,
    'plan_items_remaining',
      CASE WHEN v_items_limit IS NULL THEN NULL
           ELSE GREATEST(v_items_limit - v_items_used, 0)
      END,
    'pack_credits_remaining', v_pack_total,
    'total_available', v_sub_remaining + v_pack_total,
    'download_limit', v_download_limit,
    'download_cost', 1,
    'audiobook_pack_only', TRUE,
    'costs', jsonb_build_object(
      'short', 2,
      'medium', 4,
      'long', 6,
      'chapter_regeneration', 1,
      'visual_regeneration', 1,
      'cover_generation', 1,
      'audiobook_short', 4,
      'audiobook_medium', 8,
      'audiobook_long', 12,
      'book_download', 1,
      'full_regeneration_short', 2,
      'full_regeneration_medium', 4,
      'full_regeneration_long', 6,
      'full_rework_short', 2,
      'full_rework_medium', 4,
      'full_rework_long', 6
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_get_entitlement() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_get_entitlement() TO authenticated;

-- ============================================================
-- 4. Reservation (full_rework consumes a plan slot)
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
  v_items_limit INTEGER := NULL;
  v_items_used INTEGER := 0;
  v_pack_only BOOLEAN := (p_operation = 'audiobook');
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

  -- Narration is priced from the stored manuscript length, never the request.
  v_cost := public.bookmaker_operation_cost(
    p_operation,
    CASE
      WHEN p_operation IN ('initial_book', 'full_regeneration', 'full_rework', 'audiobook') AND p_book_id IS NOT NULL
        THEN COALESCE(v_book.length, p_length)
      ELSE p_length
    END
  );

  -- Pin the manuscript shape at reservation time. A book cannot be made
  -- cheaper by editing its length after credits have been reserved.
  IF p_operation IN ('initial_book', 'full_regeneration', 'full_rework') AND p_book_id IS NOT NULL THEN
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
  ELSIF p_operation = 'audiobook' AND p_book_id IS NOT NULL THEN
    -- Keep the narrator's total_chapters for partial refunds, but record the
    -- length the price was based on.
    v_metadata := jsonb_set(v_metadata, '{length}', to_jsonb(v_book.length));
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

  -- Narration is platform-credit only: leave the subscription grant untouched
  -- and never let included plan credits pay for it.
  IF NOT v_pack_only THEN
    v_grant := public.bookmaker_ensure_subscription_grant(v_user);
    IF v_grant.id IS NOT NULL THEN
      SELECT * INTO v_grant
      FROM public.bookmaker_subscription_credits
      WHERE id = v_grant.id
      FOR UPDATE;
      v_sub_available := GREATEST(v_grant.credits_granted - v_grant.credits_used, 0);
    END IF;
  END IF;

  -- Plan quota: a new ebook (or a full rework) counts once per subscription
  -- period, regardless of whether it was paid with included credits or a
  -- top-up pack. Narration is not part of the plan allowance.
  IF p_operation IN ('initial_book', 'full_rework') AND v_grant.id IS NOT NULL THEN
    v_items_limit := public.bookmaker_plan_item_limit(v_grant.subscription_type);

    IF v_items_limit IS NOT NULL THEN
      SELECT COUNT(*) INTO v_items_used
      FROM public.bookmaker_credit_operations
      WHERE user_id = v_user
        AND operation IN ('initial_book', 'full_rework')
        AND status IN ('pending', 'completed')
        AND created_at >= v_grant.period_start
        AND created_at < v_grant.period_end;

      IF v_items_used >= v_items_limit THEN
        RETURN jsonb_build_object(
          'success', FALSE,
          'reason', 'plan_limit',
          'message', format(
            'Your %s plan includes %s ebook creations this period. Upgrade your plan to keep creating.',
            replace(v_grant.subscription_type, '_', ' '),
            v_items_limit
          ),
          'items_limit', v_items_limit,
          'items_used', v_items_used,
          'entitlement', public.bookmaker_get_entitlement()
        );
      END IF;
    END IF;
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
      'message', CASE WHEN v_pack_only
        THEN 'Audiobook narration uses platform credits from a credit pack. Subscription credits and plan allowances cannot be used for narration.'
        ELSE 'You do not have enough AI credits for this operation.'
      END,
      'requires_packs', v_pack_only,
      'cost', v_cost,
      'available', v_available,
      'shortfall', v_cost - v_available,
      'entitlement', public.bookmaker_get_entitlement()
    );
  END IF;

  -- Debit subscription included credits first (never for narration).
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
-- 5. Stopping a rework refunds the chapters it never wrote
-- ============================================================
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

  IF v_op.operation IN ('initial_book', 'full_regeneration', 'full_rework') THEN
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

-- ============================================================
-- 5. Admin analytics
-- ============================================================
CREATE OR REPLACE FUNCTION public.bookmaker_admin_analytics(
  p_range TEXT DEFAULT 'all_time',
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_range TEXT := lower(replace(COALESCE(p_range, 'all_time'), ' ', '_'));
  v_start TIMESTAMPTZ := NULL;
  v_total_users BIGINT := 0;
  v_active_users BIGINT := 0;
  v_paying_customers BIGINT := 0;
  v_revenue_kobo BIGINT := 0;
  v_ebooks BIGINT := 0;
  v_audiobooks BIGINT := 0;
  v_failed BIGINT := 0;
  v_ai_cost_usd NUMERIC := 0;
  v_transactions JSONB := '[]'::jsonb;
  v_generations JSONB := '[]'::jsonb;
  v_user JSONB := NULL;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'reason', 'forbidden',
      'message', 'Admin access is required.'
    );
  END IF;

  IF v_range IN ('today') THEN
    v_start := date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
  ELSIF v_range IN ('7d', 'last_7_days', 'week', 'per_user_7d') THEN
    v_start := now() - INTERVAL '7 days';
  ELSIF v_range IN ('30d', 'last_30_days', 'month') THEN
    v_start := now() - INTERVAL '30 days';
  ELSE
    v_start := NULL;
  END IF;

  -- Users ------------------------------------------------------------------
  SELECT COUNT(*) INTO v_total_users
  FROM public.profiles p
  WHERE (
    p_user_id IS NOT NULL AND p.id = p_user_id
  ) OR (
    p_user_id IS NULL AND (v_start IS NULL OR p.created_at >= v_start)
  );

  -- A member counts as active when they did anything paid or AI-driven in the
  -- period. Payment activity counts too, so subscribers are never invisible.
  SELECT COUNT(DISTINCT activity.user_id) INTO v_active_users
  FROM (
    SELECT o.user_id
    FROM public.bookmaker_credit_operations o
    WHERE (p_user_id IS NULL OR o.user_id = p_user_id)
      AND (v_start IS NULL OR o.created_at >= v_start)
    UNION
    SELECT b.user_id
    FROM public.bookmaker_books b
    WHERE (p_user_id IS NULL OR b.user_id = p_user_id)
      AND (v_start IS NULL OR b.updated_at >= v_start)
    UNION
    SELECT sp.user_id
    FROM public.subscription_payments sp
    WHERE (p_user_id IS NULL OR sp.user_id = p_user_id)
      AND (v_start IS NULL OR sp.created_at >= v_start)
    UNION
    SELECT ap.user_id
    FROM public.audit_pack_payments ap
    WHERE (p_user_id IS NULL OR ap.user_id = p_user_id)
      AND (v_start IS NULL OR ap.created_at >= v_start)
  ) activity;

  -- Revenue: successful payments only.
  SELECT COUNT(DISTINCT paid.user_id) INTO v_paying_customers
  FROM (
    SELECT sp.user_id, sp.amount_kobo
    FROM public.subscription_payments sp
    WHERE sp.status = 'completed'
      AND (p_user_id IS NULL OR sp.user_id = p_user_id)
      AND (v_start IS NULL OR sp.created_at >= v_start)
    UNION ALL
    SELECT ap.user_id, ap.amount_kobo
    FROM public.audit_pack_payments ap
    WHERE ap.status = 'completed'
      AND (p_user_id IS NULL OR ap.user_id = p_user_id)
      AND (v_start IS NULL OR ap.created_at >= v_start)
  ) paid;

  SELECT COALESCE(SUM(paid.amount_kobo), 0)::BIGINT INTO v_revenue_kobo
  FROM (
    SELECT sp.amount_kobo
    FROM public.subscription_payments sp
    WHERE sp.status = 'completed'
      AND (p_user_id IS NULL OR sp.user_id = p_user_id)
      AND (v_start IS NULL OR sp.created_at >= v_start)
    UNION ALL
    SELECT ap.amount_kobo
    FROM public.audit_pack_payments ap
    WHERE ap.status = 'completed'
      AND (p_user_id IS NULL OR ap.user_id = p_user_id)
      AND (v_start IS NULL OR ap.created_at >= v_start)
  ) paid;

  -- Generation outcomes: successful completions only.
  SELECT COUNT(*) INTO v_ebooks
  FROM public.bookmaker_credit_operations o
  WHERE o.operation IN ('initial_book', 'full_rework')
    AND o.status = 'completed'
    AND (p_user_id IS NULL OR o.user_id = p_user_id)
    AND (v_start IS NULL OR COALESCE(o.completed_at, o.created_at) >= v_start);

  SELECT COUNT(*) INTO v_audiobooks
  FROM public.bookmaker_credit_operations o
  WHERE o.operation = 'audiobook'
    AND o.status = 'completed'
    AND (p_user_id IS NULL OR o.user_id = p_user_id)
    AND (v_start IS NULL OR COALESCE(o.completed_at, o.created_at) >= v_start);

  SELECT COUNT(*) INTO v_failed
  FROM public.bookmaker_credit_operations o
  WHERE o.status = 'failed'
    AND (p_user_id IS NULL OR o.user_id = p_user_id)
    AND (v_start IS NULL OR o.created_at >= v_start);

  -- AI cost: what the recorded API calls actually cost.
  SELECT COALESCE(SUM(o.ai_cost_usd), 0) INTO v_ai_cost_usd
  FROM public.bookmaker_credit_operations o
  WHERE (p_user_id IS NULL OR o.user_id = p_user_id)
    AND (v_start IS NULL OR o.created_at >= v_start);

  -- Recent transactions -----------------------------------------------------
  SELECT COALESCE(jsonb_agg(row.entry ORDER BY row.created_at DESC), '[]'::jsonb)
  INTO v_transactions
  FROM (
    SELECT
      jsonb_build_object(
        'id', sp.id,
        'kind', 'subscription',
        'label', initcap(replace(sp.plan_type, '_', ' ')),
        'user_id', sp.user_id,
        'user_name', COALESCE(NULLIF(p.full_name, ''), p.email, 'Member'),
        'email', p.email,
        'amount_kobo', sp.amount_kobo,
        'status', sp.status,
        'reference', sp.reference,
        'created_at', sp.created_at
      ) AS entry,
      sp.created_at
    FROM public.subscription_payments sp
    LEFT JOIN public.profiles p ON p.id = sp.user_id
    WHERE (p_user_id IS NULL OR sp.user_id = p_user_id)
      AND (v_start IS NULL OR sp.created_at >= v_start)
    UNION ALL
    SELECT
      jsonb_build_object(
        'id', ap.id,
        'kind', 'credits',
        'label', COALESCE(ucp.pack_name, 'Credit pack'),
        'user_id', ap.user_id,
        'user_name', COALESCE(NULLIF(p.full_name, ''), p.email, 'Member'),
        'email', p.email,
        'amount_kobo', ap.amount_kobo,
        'status', ap.status,
        'reference', ap.reference,
        'created_at', ap.created_at
      ) AS entry,
      ap.created_at
    FROM public.audit_pack_payments ap
    LEFT JOIN public.profiles p ON p.id = ap.user_id
    LEFT JOIN public.user_credit_packs ucp ON ucp.reference = ap.reference
    WHERE (p_user_id IS NULL OR ap.user_id = p_user_id)
      AND (v_start IS NULL OR ap.created_at >= v_start)
    ORDER BY created_at DESC
    LIMIT 20
  ) row;

  -- Recent book generations -------------------------------------------------
  SELECT COALESCE(jsonb_agg(row.entry ORDER BY row.created_at DESC), '[]'::jsonb)
  INTO v_generations
  FROM (
    SELECT
      jsonb_build_object(
        'id', o.id,
        'operation', o.operation,
        'status', o.status,
        'book_id', o.book_id,
        'book_title', COALESCE(NULLIF(b.title, ''), 'Untitled ebook'),
        'user_id', o.user_id,
        'user_name', COALESCE(NULLIF(p.full_name, ''), p.email, 'Member'),
        'credit_cost', o.credit_cost,
        'ai_cost_usd', o.ai_cost_usd,
        'ai_audio_characters', o.ai_audio_characters,
        'error', o.error,
        'created_at', o.created_at,
        'completed_at', o.completed_at
      ) AS entry,
      o.created_at
    FROM public.bookmaker_credit_operations o
    LEFT JOIN public.bookmaker_books b ON b.id = o.book_id
    LEFT JOIN public.profiles p ON p.id = o.user_id
    WHERE o.operation IN (
      'initial_book', 'full_rework', 'full_regeneration', 'audiobook',
      'chapter_regeneration', 'visual_regeneration', 'cover_generation'
    )
      AND (p_user_id IS NULL OR o.user_id = p_user_id)
      AND (v_start IS NULL OR o.created_at >= v_start)
    ORDER BY o.created_at DESC
    LIMIT 20
  ) row;

  -- Per-user snapshot (credits, plan, expiry) -------------------------------
  IF p_user_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', p.id,
      'name', COALESCE(NULLIF(p.full_name, ''), p.email, 'Member'),
      'email', p.email,
      'subscription_type', p.subscription_type,
      'subscription_expires_at', p.subscription_expires_at,
      'pack_credits', COALESCE((
        SELECT SUM(ucp.credits_remaining) FROM public.user_credit_packs ucp
        WHERE ucp.user_id = p.id
          AND ucp.status = 'active'
          AND (ucp.expires_at IS NULL OR ucp.expires_at > now())
      ), 0),
      'subscription_credits', COALESCE((
        SELECT GREATEST(sc.credits_granted - sc.credits_used, 0)
        FROM public.bookmaker_subscription_credits sc
        WHERE sc.user_id = p.id AND sc.period_end > now()
        ORDER BY sc.period_end DESC
        LIMIT 1
      ), 0)
    ) INTO v_user
    FROM public.profiles p
    WHERE p.id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'range', v_range,
    'start', v_start,
    'user', v_user,
    'metrics', jsonb_build_object(
      'total_users', v_total_users,
      'active_users', v_active_users,
      'paying_customers', v_paying_customers,
      'revenue_kobo', v_revenue_kobo,
      'ebooks_generated', v_ebooks,
      'audiobooks_generated', v_audiobooks,
      'failed_generations', v_failed,
      'ai_cost_usd', v_ai_cost_usd
    ),
    'recent_transactions', v_transactions,
    'recent_generations', v_generations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_admin_analytics(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_admin_analytics(TEXT, UUID) TO authenticated;
