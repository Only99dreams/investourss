-- ============================================================
-- Bookmaker books are visible to their owner only
-- ============================================================
-- Generated ebooks must never be readable across accounts. The admin-wide
-- policy let staff accounts list every member's books in the member
-- dashboard, and an environment that applied only part of the schema had no
-- owner policy at all. Re-assert row-level security with a single owner rule.
--
-- Support tooling reads through the service role in the bookmaker edge
-- function, which already checks ownership before returning a book.

ALTER TABLE public.bookmaker_books ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage all bookmaker books" ON public.bookmaker_books;

DROP POLICY IF EXISTS "Owner manages own bookmaker books" ON public.bookmaker_books;
CREATE POLICY "Owner manages own bookmaker books"
  ON public.bookmaker_books FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.bookmaker_books FROM anon;
