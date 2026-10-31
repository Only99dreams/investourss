-- ============================================================
-- Audiobook downloads: three free downloads for every chapter and
-- for the complete audiobook, then 2/4/6 pack credits by length.
-- Counts are kept per book for the life of the book and never reset.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bookmaker_audio_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES public.bookmaker_books(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL CHECK (item_key = 'full' OR item_key ~ '^chapter-[0-9]{1,4}$'),
  idempotency_key TEXT NOT NULL,
  cost_credits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bookmaker_audio_downloads_book_item
  ON public.bookmaker_audio_downloads (book_id, item_key);

ALTER TABLE public.bookmaker_audio_downloads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read their audiobook downloads" ON public.bookmaker_audio_downloads;
CREATE POLICY "Members read their audiobook downloads"
  ON public.bookmaker_audio_downloads
  FOR SELECT
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- Price per download once the free allowance is used up
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bookmaker_audio_download_price(p_length TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_length, 'medium'))
    WHEN 'short' THEN 2
    WHEN 'long' THEN 6
    ELSE 4
  END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_audio_download_price(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_audio_download_price(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookmaker_audio_download_price(TEXT) TO service_role;

-- ------------------------------------------------------------
-- Usage snapshot for the player (per chapter and complete book)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bookmaker_audio_download_status(p_book_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_book public.bookmaker_books;
  v_items JSONB := '{}'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'unauthenticated', 'message', 'Please sign in.');
  END IF;

  SELECT * INTO v_book
  FROM public.bookmaker_books
  WHERE id = p_book_id AND user_id = v_user;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'book_not_found', 'message', 'Book not found.');
  END IF;

  SELECT COALESCE(jsonb_object_agg(counts.item_key, counts.used), '{}'::jsonb)
  INTO v_items
  FROM (
    SELECT item_key, COUNT(*)::INTEGER AS used
    FROM public.bookmaker_audio_downloads
    WHERE book_id = p_book_id
    GROUP BY item_key
  ) AS counts;

  RETURN jsonb_build_object(
    'success', TRUE,
    'free_limit', 3,
    'cost', public.bookmaker_audio_download_price(v_book.length),
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_audio_download_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_audio_download_status(UUID) TO authenticated;

-- ------------------------------------------------------------
-- Consume one download: free while under the allowance, then pack credits
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bookmaker_consume_audio_download(
  p_book_id UUID,
  p_item_key TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_book public.bookmaker_books;
  v_item TEXT := lower(trim(COALESCE(p_item_key, '')));
  v_existing public.bookmaker_audio_downloads;
  v_used INTEGER := 0;
  v_limit INTEGER := 3;
  v_cost INTEGER := 0;
  v_free BOOLEAN := FALSE;
  v_available INTEGER := 0;
  v_left INTEGER := 0;
  v_debit INTEGER := 0;
  v_breakdown JSONB := '[]'::jsonb;
  v_profile_total INTEGER := 0;
  v_pack RECORD;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'unauthenticated', 'message', 'Please sign in.');
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'invalid_key', 'message', 'A valid request key is required.');
  END IF;

  IF v_item <> 'full' AND v_item !~ '^chapter-[0-9]{1,4}$' THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'invalid_item', 'message', 'Choose a chapter or the complete audiobook.');
  END IF;

  -- A retried request never counts or charges twice.
  SELECT * INTO v_existing
  FROM public.bookmaker_audio_downloads
  WHERE user_id = v_user AND idempotency_key = trim(p_idempotency_key);

  IF FOUND THEN
    SELECT COUNT(*)::INTEGER INTO v_used
    FROM public.bookmaker_audio_downloads
    WHERE book_id = v_existing.book_id AND item_key = v_existing.item_key;

    RETURN jsonb_build_object(
      'success', TRUE,
      'free', v_existing.cost_credits = 0,
      'cost', v_existing.cost_credits,
      'used', v_used,
      'limit', v_limit,
      'remaining', GREATEST(v_limit - v_used, 0),
      'duplicate', TRUE,
      'message', 'This download was already processed.'
    );
  END IF;

  -- Serialise downloads for this book so concurrent clicks cannot both
  -- take the last free slot.
  SELECT * INTO v_book
  FROM public.bookmaker_books
  WHERE id = p_book_id AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'book_not_found', 'message', 'Book not found.');
  END IF;

  IF v_item = 'full' THEN
    IF COALESCE(v_book.audiobook->'full'->>'path', '') = '' THEN
      RETURN jsonb_build_object('success', FALSE, 'reason', 'not_ready', 'message', 'The complete audiobook is not ready yet.');
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(v_book.audiobook->'chapters', '[]'::jsonb)) AS chapter
      WHERE COALESCE(chapter->>'path', '') <> ''
        AND ('chapter-' || (chapter->>'number')) = v_item
    ) THEN
      RETURN jsonb_build_object('success', FALSE, 'reason', 'not_ready', 'message', 'That chapter has not been narrated yet.');
    END IF;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_used
  FROM public.bookmaker_audio_downloads
  WHERE book_id = p_book_id AND item_key = v_item;

  v_free := v_used < v_limit;

  IF v_free THEN
    INSERT INTO public.bookmaker_audio_downloads
      (user_id, book_id, item_key, idempotency_key, cost_credits)
    VALUES
      (v_user, p_book_id, v_item, trim(p_idempotency_key), 0);

    RETURN jsonb_build_object(
      'success', TRUE,
      'free', TRUE,
      'cost', 0,
      'used', v_used + 1,
      'limit', v_limit,
      'remaining', GREATEST(v_limit - v_used - 1, 0),
      'duplicate', FALSE
    );
  END IF;

  -- Free allowance used up: charge pack credits only.
  v_cost := public.bookmaker_audio_download_price(v_book.length);

  SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER INTO v_available
  FROM public.user_credit_packs
  WHERE user_id = v_user
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  IF v_available < v_cost THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'reason', 'insufficient_credits',
      'message', format('This download costs %s credits. Top up your credit pack to continue.', v_cost),
      'cost', v_cost,
      'available', v_available,
      'shortfall', v_cost - v_available,
      'used', v_used,
      'limit', v_limit,
      'remaining', 0,
      'entitlement', public.bookmaker_get_entitlement()
    );
  END IF;

  v_left := v_cost;
  FOR v_pack IN
    SELECT *
    FROM public.user_credit_packs
    WHERE user_id = v_user
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
      AND credits_remaining > 0
    ORDER BY expires_at ASC NULLS LAST
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_debit := LEAST(v_pack.credits_remaining, v_left);
    IF v_debit > 0 THEN
      UPDATE public.user_credit_packs
      SET credits_remaining = credits_remaining - v_debit
      WHERE id = v_pack.id;

      v_breakdown := v_breakdown || jsonb_build_array(
        jsonb_build_object('pack_id', v_pack.id, 'amount', v_debit)
      );
      v_left := v_left - v_debit;
    END IF;
  END LOOP;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'Audiobook download debit failed';
  END IF;

  SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER INTO v_profile_total
  FROM public.user_credit_packs
  WHERE user_id = v_user
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
  SET audit_credits = v_profile_total, updated_at = now()
  WHERE id = v_user;

  UPDATE public.bookmaker_books
  SET credits_spent = credits_spent + v_cost,
      updated_at = now()
  WHERE id = p_book_id;

  INSERT INTO public.bookmaker_audio_downloads
    (user_id, book_id, item_key, idempotency_key, cost_credits)
  VALUES
    (v_user, p_book_id, v_item, trim(p_idempotency_key), v_cost);

  RETURN jsonb_build_object(
    'success', TRUE,
    'free', FALSE,
    'cost', v_cost,
    'used', v_used + 1,
    'limit', v_limit,
    'remaining', 0,
    'credits_from_packs', v_cost,
    'pack_breakdown', v_breakdown,
    'duplicate', FALSE,
    'entitlement', public.bookmaker_get_entitlement()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_consume_audio_download(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_consume_audio_download(UUID, TEXT, TEXT) TO authenticated;
