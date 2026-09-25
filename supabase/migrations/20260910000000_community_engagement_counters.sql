-- ============================================================
-- Community engagement counters are maintained by the database
-- ============================================================
-- posts.likes_count / shares_count / comments_count are denormalised
-- counters, but nothing in the schema maintained them. Both community
-- UIs tried to keep them in sync from the client:
--
--   * src/pages/Community.tsx only mutated local React state, so the
--     counters stayed at 0 in the database and every reload showed
--     "0 likes / 0 shares" — the actions looked like they did nothing.
--
--   * src/components/home/CommunitySection.tsx did write the counters,
--     but through `posts.update()`. The RLS policy on posts is
--       "Users can update their own posts" USING (auth.uid() = author_id)
--     so the write is silently discarded (Supabase reports no error for
--     RLS-filtered updates) whenever you like/share somebody else's post.
--     It only appeared to work because the author's own posts passed.
--
-- Fix: maintain the counters with SECURITY DEFINER triggers, so they are
-- correct for every post regardless of who acts. Each trigger recomputes
-- the value with count(*) rather than doing +1/-1, which makes it
-- idempotent and self-healing. The client-side counter writes are removed
-- in the same change or the numbers would double.
--
-- This migration is idempotent and safe to re-run.

-- ------------------------------------------------------------------
-- 1. likes
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_post_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_id UUID;
BEGIN
  v_post_id := COALESCE(NEW.post_id, OLD.post_id);
  IF v_post_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.posts
  SET likes_count = (SELECT count(*) FROM public.post_likes WHERE post_id = v_post_id)
  WHERE id = v_post_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_likes_count ON public.post_likes;
CREATE TRIGGER trg_post_likes_count
  AFTER INSERT OR DELETE ON public.post_likes
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_likes_count();

-- ------------------------------------------------------------------
-- 2. shares
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_post_shares_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_id UUID;
BEGIN
  v_post_id := COALESCE(NEW.post_id, OLD.post_id);
  IF v_post_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.posts
  SET shares_count = (SELECT count(*) FROM public.post_shares WHERE post_id = v_post_id)
  WHERE id = v_post_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_shares_count ON public.post_shares;
CREATE TRIGGER trg_post_shares_count
  AFTER INSERT OR DELETE ON public.post_shares
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_shares_count();

-- ------------------------------------------------------------------
-- 3. comments (hidden comments don't count, so is_hidden is watched)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_post_comments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_id UUID;
BEGIN
  v_post_id := COALESCE(NEW.post_id, OLD.post_id);
  IF v_post_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.posts
  SET comments_count = (
    SELECT count(*) FROM public.post_comments
    WHERE post_id = v_post_id AND is_hidden = false
  )
  WHERE id = v_post_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_comments_count ON public.post_comments;
CREATE TRIGGER trg_post_comments_count
  AFTER INSERT OR DELETE OR UPDATE OF is_hidden ON public.post_comments
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_comments_count();

-- ------------------------------------------------------------------
-- 4. Backfill existing counters from the real child rows
-- ------------------------------------------------------------------
UPDATE public.posts p SET
  likes_count = COALESCE((SELECT count(*) FROM public.post_likes l WHERE l.post_id = p.id), 0),
  shares_count = COALESCE((SELECT count(*) FROM public.post_shares s WHERE s.post_id = p.id), 0),
  comments_count = COALESCE((
    SELECT count(*) FROM public.post_comments c
    WHERE c.post_id = p.id AND c.is_hidden = false
  ), 0);

-- ------------------------------------------------------------------
-- 5. Realtime: keep the feed live when engagement changes
--    (posts is normally already in the publication; this is a no-op then)
-- ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'posts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.posts';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END;
$$;
