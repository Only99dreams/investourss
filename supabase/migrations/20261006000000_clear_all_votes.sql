-- ============================================================
-- One-off cleanup: remove every existing vote
-- ============================================================
-- Competitions now own their votes. Clearing the ledger means every
-- member's allowance is fresh and every post starts at zero, so no
-- old stage's votes linger in any category.

DELETE FROM public.post_votes;

-- The counter trigger only fires on vote rows; with the table empty it
-- has nothing left to sync, so recompute every post's count directly.
UPDATE public.posts
SET votes_count = 0;
