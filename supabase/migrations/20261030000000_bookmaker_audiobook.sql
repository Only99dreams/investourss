-- ============================================================
-- Bookmaker by Investours — Audiobook narration
-- ------------------------------------------------------------
-- Adds:
--   * bookmaker_books.audiobook       (chapter WAV files + narrator info)
--   * audiobook cost in the schedule  (3 credits for the whole book)
--   * public storage bucket for generated narration
--
-- Narration is produced server-side with Groq Orpheus (per-chapter, because
-- the TTS endpoint only accepts 200 characters per request) and uploaded as
-- WAV. The client plays and downloads the saved files directly.
-- ============================================================

-- ============================================================
-- 1. Audiobook state on the book
-- ============================================================
ALTER TABLE public.bookmaker_books
  ADD COLUMN IF NOT EXISTS audiobook JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- 2. Cost schedule
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
  ELSIF p_operation = 'audiobook' THEN
    -- Flat price: narration length varies by book, but the same reservation
    -- can be stopped early and the unused chapters are refunded.
    RETURN 3;
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
-- 3. Entitlement (keep the current balance logic, expose the new cost)
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
      'audiobook', 3,
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
-- 4. Refund unused narration if the member stops early
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

  -- The saved chapter list is the source of truth when a progress write was
  -- interrupted. A narration pass clears both at the start, so every saved
  -- chapter belongs to the current reservation.
  IF v_op.operation = 'audiobook' THEN
    SELECT GREATEST(
      v_generated,
      COALESCE(jsonb_array_length(
        CASE WHEN jsonb_typeof(b.audiobook->'chapters') = 'array'
          THEN b.audiobook->'chapters' ELSE '[]'::jsonb END
      ), 0)
    )
    INTO v_generated
    FROM public.bookmaker_books b
    WHERE b.id = v_op.book_id AND b.user_id = v_user;
  END IF;

  IF v_op.operation IN ('initial_book', 'full_regeneration', 'audiobook') THEN
    -- Whole-book reservations refund the chapters that were never delivered.
    -- `generate_chapters` is pinned at reservation time, so later edits to the
    -- outline cannot shrink or inflate the refund.
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
-- 5. Storage bucket for generated narration
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bookmaker-audio',
  'bookmaker-audio',
  TRUE,
  262144000,
  ARRAY['audio/wav']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Bookmaker audio is publicly readable" ON storage.objects;
CREATE POLICY "Bookmaker audio is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'bookmaker-audio');

-- Narration is written by the edge function with the service role. Members may
-- remove their own audio when they delete a book.
DROP POLICY IF EXISTS "Users delete own bookmaker audio" ON storage.objects;
CREATE POLICY "Users delete own bookmaker audio"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'bookmaker-audio'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
