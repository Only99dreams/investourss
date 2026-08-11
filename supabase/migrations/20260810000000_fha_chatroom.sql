-- FHA Chatroom: ambassador-only community feed
-- - fha_chatroom_posts, fha_chatroom_comments, fha_chatroom_likes
-- - RLS: only users with active ambassador eligibility can participate
-- - Realtime publication for live updates

-- ============================================================
-- 1. Tables
-- ============================================================
CREATE TABLE public.fha_chatroom_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  attachment_url TEXT,
  attachment_type TEXT,
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  is_pinned BOOLEAN DEFAULT FALSE,
  is_hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.fha_chatroom_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.fha_chatroom_posts(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  is_hidden BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.fha_chatroom_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES public.fha_chatroom_posts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (post_id, user_id)
);

-- ============================================================
-- 2. Indexes
-- ============================================================
CREATE INDEX idx_fha_chatroom_posts_author_id ON public.fha_chatroom_posts (author_id);
CREATE INDEX idx_fha_chatroom_posts_created_at ON public.fha_chatroom_posts (created_at DESC);
CREATE INDEX idx_fha_chatroom_comments_post_id ON public.fha_chatroom_comments (post_id);
CREATE INDEX idx_fha_chatroom_likes_post_id ON public.fha_chatroom_likes (post_id);
CREATE INDEX idx_fha_chatroom_likes_user_id ON public.fha_chatroom_likes (user_id);

-- ============================================================
-- 3. RLS
-- ============================================================
ALTER TABLE public.fha_chatroom_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fha_chatroom_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fha_chatroom_likes ENABLE ROW LEVEL SECURITY;

-- Posts: active ambassadors can view non-hidden posts; authors can view their own
CREATE POLICY "Active ambassadors can view chatroom posts"
  ON public.fha_chatroom_posts FOR SELECT
  USING (
    public.check_ambassador_eligibility(auth.uid())
    AND (is_hidden = FALSE OR auth.uid() = author_id)
  );

CREATE POLICY "Active ambassadors can create posts"
  ON public.fha_chatroom_posts FOR INSERT
  WITH CHECK (
    public.check_ambassador_eligibility(auth.uid())
    AND auth.uid() = author_id
  );

CREATE POLICY "Authors can update own posts"
  ON public.fha_chatroom_posts FOR UPDATE
  USING (auth.uid() = author_id);

CREATE POLICY "Authors can delete own posts"
  ON public.fha_chatroom_posts FOR DELETE
  USING (auth.uid() = author_id);

CREATE POLICY "Admins can manage all chatroom posts"
  ON public.fha_chatroom_posts FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Comments
CREATE POLICY "Active ambassadors can view comments"
  ON public.fha_chatroom_comments FOR SELECT
  USING (
    public.check_ambassador_eligibility(auth.uid())
    AND (is_hidden = FALSE OR auth.uid() = author_id)
  );

CREATE POLICY "Active ambassadors can create comments"
  ON public.fha_chatroom_comments FOR INSERT
  WITH CHECK (
    public.check_ambassador_eligibility(auth.uid())
    AND auth.uid() = author_id
  );

CREATE POLICY "Authors can update own comments"
  ON public.fha_chatroom_comments FOR UPDATE
  USING (auth.uid() = author_id);

CREATE POLICY "Authors can delete own comments"
  ON public.fha_chatroom_comments FOR DELETE
  USING (auth.uid() = author_id);

CREATE POLICY "Admins can manage all comments"
  ON public.fha_chatroom_comments FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Likes
CREATE POLICY "Active ambassadors can view likes"
  ON public.fha_chatroom_likes FOR SELECT
  USING (public.check_ambassador_eligibility(auth.uid()));

CREATE POLICY "Active ambassadors can like"
  ON public.fha_chatroom_likes FOR INSERT
  WITH CHECK (
    public.check_ambassador_eligibility(auth.uid())
    AND auth.uid() = user_id
  );

CREATE POLICY "Users can unlike"
  ON public.fha_chatroom_likes FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all likes"
  ON public.fha_chatroom_likes FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- ============================================================
-- 4. Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.fha_chatroom_posts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fha_chatroom_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fha_chatroom_likes;

-- ============================================================
-- 5. updated_at trigger
-- ============================================================
DROP TRIGGER IF EXISTS update_fha_chatroom_posts_updated_at ON public.fha_chatroom_posts;
CREATE TRIGGER update_fha_chatroom_posts_updated_at BEFORE UPDATE ON public.fha_chatroom_posts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
