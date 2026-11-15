-- ============================================================
-- Bookmaker — an active subscription includes every AI operation
-- ============================================================
-- A member with a live subscription no longer spends credits on Bookmaker:
-- writing, full regeneration, rework, chapter/visual/cover rewrites and
-- audiobook narration are all covered by the plan. The plan's ebook
-- allowance still caps new books and full reworks, and download quotas are
-- unchanged because they limit PDF/audio downloads, not generation.
--
-- Members without an active subscription keep the existing credit pricing:
-- included subscription credits first, then top-up packs, and narration is
-- still pack-only for them.

-- ============================================================
-- 1. Entitlement
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
  v_included BOOLEAN := FALSE;
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
      'operations_included', FALSE,
      'subscription_credits_remaining', 0,
      'pack_credits_remaining', 0,
      'total_available', 0,
      'download_limit', 0,
      'download_cost', 1,
      'audiobook_pack_only', TRUE
    );
  END IF;

  v_grant := public.bookmaker_ensure_subscription_grant(v_user);
  v_included := v_grant.id IS NOT NULL;

  IF v_included THEN
    v_sub_remaining := GREATEST(v_grant.credits_granted - v_grant.credits_used, 0);
    v_items_limit := public.bookmaker_plan_item_limit(v_grant.subscription_type);

    -- A book written from scratch and a full rework both use one slot.
    -- Narration is included in the plan and is not part of this count.
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
    'subscription_active', v_included,
    'operations_included', v_included,
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
    'audiobook_pack_only', NOT v_included,
    'costs', jsonb_build_object(
      'short', CASE WHEN v_included THEN 0 ELSE 2 END,
      'medium', CASE WHEN v_included THEN 0 ELSE 4 END,
      'long', CASE WHEN v_included THEN 0 ELSE 6 END,
      'chapter_regeneration', CASE WHEN v_included THEN 0 ELSE 1 END,
      'visual_regeneration', CASE WHEN v_included THEN 0 ELSE 1 END,
      'cover_generation', CASE WHEN v_included THEN 0 ELSE 1 END,
      'audiobook_short', CASE WHEN v_included THEN 0 ELSE 4 END,
      'audiobook_medium', CASE WHEN v_included THEN 0 ELSE 8 END,
      'audiobook_long', CASE WHEN v_included THEN 0 ELSE 12 END,
      'book_download', 1,
      'full_regeneration_short', CASE WHEN v_included THEN 0 ELSE 2 END,
      'full_regeneration_medium', CASE WHEN v_included THEN 0 ELSE 4 END,
      'full_regeneration_long', CASE WHEN v_included THEN 0 ELSE 6 END,
      'full_rework_short', CASE WHEN v_included THEN 0 ELSE 2 END,
      'full_rework_medium', CASE WHEN v_included THEN 0 ELSE 4 END,
      'full_rework_long', CASE WHEN v_included THEN 0 ELSE 6 END,
      'title_regeneration', 0
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_get_entitlement() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_get_entitlement() TO authenticated;

-- ============================================================
-- 2. Reservation (subscribed operations reserve zero credits)
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
  v_included BOOLEAN := FALSE;
  v_pack_available INTEGER := 0;
  v_available INTEGER := 0;
  v_pack_debit INTEGER := 0;
  v_pack_left INTEGER := 0;
  v_pack_breakdown JSONB := '[]'::jsonb;
  v_profile_total INTEGER := 0;
  v_metadata JSONB := COALESCE(p_metadata, '{}'::jsonb);
  v_op public.bookmaker_credit_operations;
  v_items_limit INTEGER := NULL;
  v_items_used INTEGER := 0;
  v_pack_only BOOLEAN := FALSE;
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

  -- An active subscription covers every generation operation.
  v_grant := public.bookmaker_ensure_subscription_grant(v_user);
  v_included := v_grant.id IS NOT NULL;
  v_pack_only := (p_operation = 'audiobook' AND NOT v_included);

  -- Price from the stored manuscript shape, never from the request.
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

  -- Plan quota: a new ebook (or a full rework) counts once per subscription
  -- period. This is enforced before the subscription zeroes the price, so a
  -- subscriber still cannot create more books than the plan advertises.
  IF p_operation IN ('initial_book', 'full_rework') AND v_included THEN
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

  -- Subscribers pay nothing for generation; the row stays auditable.
  IF v_included THEN
    v_cost := 0;
    v_metadata := jsonb_set(v_metadata, '{subscription_included}', 'true'::jsonb);
  END IF;

  -- Free operations still get an auditable row, but no balance check.
  IF v_cost = 0 THEN
    INSERT INTO public.bookmaker_credit_operations
      (user_id, book_id, operation, idempotency_key, credit_cost, status,
       subscription_grant_id, metadata)
    VALUES
      (v_user, p_book_id, p_operation, p_idempotency_key, 0, 'pending',
       v_grant.id, v_metadata)
    RETURNING * INTO v_op;

    RETURN jsonb_build_object(
      'success', TRUE,
      'operation_id', v_op.id,
      'cost', 0,
      'credits_from_subscription', 0,
      'credits_from_packs', 0,
      'duplicate', FALSE,
      'entitlement', public.bookmaker_get_entitlement()
    );
  END IF;

  -- Only members without an active subscription reach this point.
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

  v_available := v_pack_available;

  IF v_cost > v_available THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'reason', 'insufficient_credits',
      'message', CASE WHEN v_pack_only
        THEN 'Audiobook narration uses platform credits from a credit pack. Subscribe to include narration, or buy a credit pack.'
        ELSE 'You do not have enough AI credits for this operation. Subscribe to include all Bookmaker AI operations, or buy credits.'
      END,
      'requires_packs', v_pack_only,
      'cost', v_cost,
      'available', v_available,
      'shortfall', v_cost - v_available,
      'entitlement', public.bookmaker_get_entitlement()
    );
  END IF;

  -- Debit credit packs, oldest expiry first.
  v_pack_left := v_cost;
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
     0, v_cost, v_grant.id,
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
    'credits_from_subscription', 0,
    'credits_from_packs', v_cost,
    'duplicate', FALSE,
    'entitlement', public.bookmaker_get_entitlement()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_reserve_operation(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_reserve_operation(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
