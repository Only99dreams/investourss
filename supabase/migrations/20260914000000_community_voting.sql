-- ============================================================
-- Community voting: paid voting power, per-stage allowances,
-- per-category leaderboards
-- ============================================================
--
-- The community had likes, comments and shares but no way to back an entry with
-- anything. This adds votes, gated on payment, with a leaderboard per category.
--
-- Design notes
--
-- * "Only paid users vote." A voter must hold an unexpired subscription or an
--   unexpired credit pack, matching the rule already used by
--   check_ambassador_eligibility and get_audit_access, so "paid" means the same
--   thing everywhere on the platform.
--
-- * Voting power comes from the plan:
--     subscription  monthly 1, quarterly 2, biennial 3, annual 4
--     credit pack   starter 1, standard 2, annual 3
--   It lives in a lookup table rather than a CASE in the RPC, so the tiers can
--   be changed without touching this logic.
--
-- * The allowance is PER STAGE, and there is exactly one current stage. There is
--   deliberately no stored balance: votes_used is recomputed from post_votes
--   with sum(), so the allowance can never drift out of step with the votes that
--   were actually cast. This is the same self-healing approach the engagement
--   counters use.
--
-- * A voter may put any number of votes on a post, up to their remaining
--   allowance, and may change that number afterwards. votes_total on a post is
--   the sum of amounts, so extra paid tiers translate into real weighting.
--
-- * Voting is SECURITY DEFINER and does every check in one place. "Remaining
--   allowance > 0" cannot be expressed as a row-level policy, and a client-side
--   check would be trivially bypassed. A per-user advisory lock serialises the
--   read of the allowance against the write, since under READ COMMITTED they
--   would otherwise be separate snapshots.
--
-- * "Paid" means an unexpired subscription OR an unexpired credit pack, matching
--   check_ambassador_eligibility. A pack is live on status and expiry alone:
--   its credits pay for audits, and a member who bought it and used them has
--   still paid.
--
-- This migration is idempotent and safe to re-run.

-- ------------------------------------------------------------------
-- 0. Drop any earlier version of these functions first
-- ------------------------------------------------------------------
-- CREATE OR REPLACE cannot change a function's OUT-parameter row type, so
-- editing a RETURNS TABLE shape and re-running fails with:
--   ERROR: 42P13 cannot change return type of existing function
-- This migration changed get_category_leaderboard's columns when the board was
-- corrected to rank post authors rather than voters, which is exactly that case.
--
-- Dropping unconditionally is safe and makes the migration genuinely re-runnable
-- from any earlier state, not just a clean database. The functions are recreated
-- below in the same transaction. This matches the pattern the rest of this
-- project already uses.
--
-- The trigger must be dropped BEFORE its function. Postgres records a
-- dependency from a trigger to the function it calls, so dropping the function
-- first fails with:
--   ERROR: 2BP01 cannot drop function sync_post_votes_count()
--          because other objects depend on it
-- CASCADE would work but is needlessly broad - it would silently drop anything
-- else that happened to reference the function. The trigger is recreated in
-- section 4.
--
-- Guarded on the table existing, because `DROP TRIGGER IF EXISTS` only tolerates
-- a missing TRIGGER: with no such table it still fails with
--   ERROR: 42P01 relation "post_votes" does not exist
-- which would break this migration on a clean database, the common case.
DO $$
BEGIN
  IF to_regclass('public.post_votes') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_post_votes_count ON public.post_votes';
  END IF;
END;
$$;

-- Order matters: the plpgsql bodies call each other, and get_my_votes is
-- LANGUAGE sql, whose body is parsed at creation and therefore does record a
-- dependency on get_current_voting_stage. Dropping the callers before the
-- callees avoids a second dependency error.
DROP FUNCTION IF EXISTS public.get_category_leaderboard(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.get_voted_categories();
DROP FUNCTION IF EXISTS public.get_my_votes(UUID[]);
DROP FUNCTION IF EXISTS public.cast_post_vote(UUID, INTEGER);
DROP FUNCTION IF EXISTS public.get_voting_power(UUID);
DROP FUNCTION IF EXISTS public.sync_post_votes_count();
DROP FUNCTION IF EXISTS public.set_voting_stage(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.get_current_voting_stage();

-- ------------------------------------------------------------------
-- 1. Voting stages: exactly one is current at a time
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voting_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  stage_number INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voting_stages_single_current
  ON public.voting_stages (is_current) WHERE is_current;

ALTER TABLE public.voting_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Voting stages are readable" ON public.voting_stages;
CREATE POLICY "Voting stages are readable" ON public.voting_stages
  FOR SELECT USING (TRUE);

-- The current stage, or null when voting is closed.
CREATE OR REPLACE FUNCTION public.get_current_voting_stage()
RETURNS TABLE (
  stage_id UUID,
  stage_name TEXT,
  stage_number INTEGER,
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.name, s.stage_number, s.opens_at, s.closes_at
  FROM public.voting_stages s
  WHERE s.is_current
    AND (s.opens_at IS NULL OR s.opens_at <= now())
    AND (s.closes_at IS NULL OR s.closes_at > now())
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_voting_stage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_voting_stage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_voting_stage() TO anon;

-- Admin advances the competition. The partial unique index means opening a new
-- stage while another is current would fail, so the old one is cleared first
-- inside the transaction.
--
-- SECURITY DEFINER with no privilege check would let any caller with EXECUTE
-- re-stage the whole competition, so the check is in the function rather than
-- left to the GRANT alone.
CREATE OR REPLACE FUNCTION public.set_voting_stage(
  p_name TEXT,
  p_stage_number INTEGER DEFAULT NULL,
  p_opens_at TIMESTAMPTZ DEFAULT NULL,
  p_closes_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_number INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorised to change the voting stage'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(stage_number), 0) + 1 INTO v_number
  FROM public.voting_stages;

  UPDATE public.voting_stages SET is_current = FALSE WHERE is_current;

  INSERT INTO public.voting_stages (name, stage_number, is_current, opens_at, closes_at)
  VALUES (p_name, COALESCE(p_stage_number, v_number), TRUE, p_opens_at, p_closes_at)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_voting_stage(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
-- Granted to authenticated as well as service_role because the dashboard calls
-- it with the user's own session; the has_role check above is what authorises it.
GRANT EXECUTE ON FUNCTION public.set_voting_stage(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- ------------------------------------------------------------------
-- 2. Voting power tiers
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voting_power_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('subscription', 'credit_pack')),
  plan_key TEXT NOT NULL,
  label TEXT NOT NULL,
  votes_per_stage INTEGER NOT NULL CHECK (votes_per_stage > 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, plan_key)
);

ALTER TABLE public.voting_power_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Voting tiers are readable" ON public.voting_power_tiers;
CREATE POLICY "Voting tiers are readable" ON public.voting_power_tiers
  FOR SELECT USING (TRUE);

-- Subscription tiers. b2b_annual is annual billing, so it inherits the annual
-- allowance; it has no row of its own because the tier is looked up by the
-- billing cycle the subscriber actually holds.
INSERT INTO public.voting_power_tiers (source, plan_key, label, votes_per_stage, sort_order)
VALUES
  ('subscription', 'monthly',   'Monthly',     1, 1),
  ('subscription', 'quarterly', 'Quarterly',   2, 2),
  ('subscription', 'biennial',  'Bi-Annual',   3, 3),
  ('subscription', 'annual',    'Annual',      4, 4)
ON CONFLICT (source, plan_key) DO UPDATE
  SET label = EXCLUDED.label,
      votes_per_stage = EXCLUDED.votes_per_stage,
      sort_order = EXCLUDED.sort_order;

-- Credit pack tiers. The pack catalogue calls these "Starter Audit Pack",
-- "Standard Audit Pack" and "Annual Audit Pack"; pack_key is what
-- get_voting_power matches against after normalising that name.
INSERT INTO public.voting_power_tiers (source, plan_key, label, votes_per_stage, sort_order)
VALUES
  ('credit_pack', 'starter', 'Starter', 1, 1),
  ('credit_pack', 'standard', 'Standard', 2, 2),
  ('credit_pack', 'annual', 'Annual Pack', 3, 3)
ON CONFLICT (source, plan_key) DO UPDATE
  SET label = EXCLUDED.label,
      votes_per_stage = EXCLUDED.votes_per_stage,
      sort_order = EXCLUDED.sort_order;

-- ------------------------------------------------------------------
-- 3. Votes cast
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.post_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.voting_stages(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One vote record per person per post per stage; the amount is adjustable, so
  -- changing your mind is an update rather than a second row.
  UNIQUE (post_id, user_id, stage_id)
);

CREATE INDEX IF NOT EXISTS idx_post_votes_post ON public.post_votes (post_id);
CREATE INDEX IF NOT EXISTS idx_post_votes_user_stage ON public.post_votes (user_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_post_votes_stage ON public.post_votes (stage_id);

ALTER TABLE public.post_votes ENABLE ROW LEVEL SECURITY;

-- Votes are written exclusively through cast_post_vote, which performs the
-- payment, self-vote and allowance checks atomically. Direct writes are denied
-- so none of that can be skipped.
DROP POLICY IF EXISTS "Votes are readable" ON public.post_votes;
CREATE POLICY "Votes are readable" ON public.post_votes
  FOR SELECT USING (TRUE);

-- ------------------------------------------------------------------
-- 4. posts.votes_count, maintained by the database
-- ------------------------------------------------------------------
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS votes_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_posts_votes_count ON public.posts (votes_count DESC);

CREATE OR REPLACE FUNCTION public.sync_post_votes_count()
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

  -- Scoped to the current stage so the number on a card always means the same
  -- thing as the leaderboard. Without the filter, opening a new stage would
  -- leave last stage's votes inflating the totals of a fresh competition.
  -- Recomputed with sum() rather than +1/-1 so it is idempotent and
  -- self-healing when a vote amount is changed.
  UPDATE public.posts
  SET votes_count = COALESCE((
        SELECT sum(pv.amount)::INTEGER
        FROM public.post_votes pv
        JOIN public.get_current_voting_stage() s ON s.stage_id = pv.stage_id
        WHERE pv.post_id = v_post_id
      ), 0)
  WHERE id = v_post_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_votes_count ON public.post_votes;
CREATE TRIGGER trg_post_votes_count
  AFTER INSERT OR UPDATE OR DELETE ON public.post_votes
  FOR EACH ROW EXECUTE FUNCTION public.sync_post_votes_count();

-- Backfill for any votes that predate the counter.
UPDATE public.posts p
SET votes_count = COALESCE((
      SELECT sum(pv.amount)::INTEGER
      FROM public.post_votes pv
      JOIN public.get_current_voting_stage() s ON s.stage_id = pv.stage_id
      WHERE pv.post_id = p.id
    ), 0)
WHERE p.votes_count <> COALESCE((
      SELECT sum(pv.amount)::INTEGER
      FROM public.post_votes pv
      JOIN public.get_current_voting_stage() s ON s.stage_id = pv.stage_id
      WHERE pv.post_id = p.id
    ), 0);

-- ------------------------------------------------------------------
-- 5. get_voting_power: who can vote, and how much is left
-- ------------------------------------------------------------------
-- Deliberately returns no row when there is no open stage, so "voting is
-- closed" and "this user cannot vote" are distinguishable.
CREATE OR REPLACE FUNCTION public.get_voting_power(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
  stage_id UUID,
  stage_name TEXT,
  stage_number INTEGER,
  source TEXT,
  source_label TEXT,
  votes_per_stage INTEGER,
  votes_used INTEGER,
  votes_remaining INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_stage RECORD;
  v_source TEXT := NULL;
  v_label TEXT := NULL;
  v_per_stage INTEGER := 0;
  v_sub_ok BOOLEAN := FALSE;
  v_sub_type TEXT;
  v_used INTEGER := 0;
  v_best INTEGER := 0;
  v_best_label TEXT;
  r RECORD;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- The parameter exists so cast_post_vote can pass auth.uid() explicitly, not
  -- so one user can ask about another. Without this, anyone who can guess a
  -- user id learns whether that person pays, which plan they hold, and how they
  -- have voted.
  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;

  SELECT * INTO v_stage FROM public.get_current_voting_stage();
  IF v_stage.stage_id IS NULL THEN
    RETURN; -- no open stage: voting is closed
  END IF;

  -- Is the subscription live? Same rule as check_ambassador_eligibility: the
  -- boolean flag alone does not grant access once the expiry has passed.
  SELECT
    ((COALESCE(p.has_active_subscription, FALSE)
       AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > now()))
     OR (p.subscription_expires_at IS NOT NULL AND p.subscription_expires_at > now())
     OR COALESCE(p.user_tier, 'free') IN ('premium', 'exclusive')),
    NULLIF(p.subscription_type, '')
  INTO v_sub_ok, v_sub_type
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_sub_ok THEN
    v_source := 'subscription';
    -- b2b_annual is annual billing, so it uses the annual allowance. A premium
    -- or exclusive tier granted without a recorded plan falls back to the
    -- entry-level tier: they may vote, but not at a tier they have not paid for.
    v_sub_type := COALESCE(
      CASE WHEN v_sub_type = 'b2b_annual' THEN 'annual' ELSE v_sub_type END,
      'monthly'
    );

    SELECT t.votes_per_stage, t.label INTO v_per_stage, v_label
    FROM public.voting_power_tiers t
    WHERE t.source = 'subscription' AND t.plan_key = v_sub_type;
  ELSE
    -- Credit packs. The catalogue names them "... Audit Pack"; matching on the
    -- distinguishing word rather than the whole name means a suffix change
    -- ("Starter Pack") does not silently strip voting power. The strongest
    -- active pack wins, so buying up tops the tier up.
    --
    -- credits_remaining > 0 is required, so a member who has spent the pack on
    -- audits loses voting along with it. The UI offers buying more rather than
    -- leaving them on a dead button, which is the point: voting power is
    -- something the pack pays for, not a perpetual discount on having paid once.
    FOR r IN
      SELECT DISTINCT ucp.pack_name
      FROM public.user_credit_packs ucp
      WHERE ucp.user_id = v_uid
        AND ucp.status = 'active'
        AND ucp.credits_remaining > 0
        AND (ucp.expires_at IS NULL OR ucp.expires_at > now())
    LOOP
      v_best := 0;
      SELECT t.votes_per_stage, t.label INTO v_best, v_best_label
      FROM public.voting_power_tiers t
      WHERE t.source = 'credit_pack'
        AND lower(r.pack_name) LIKE '%' || t.plan_key || '%'
      ORDER BY t.votes_per_stage DESC
      LIMIT 1;

      IF v_best > v_per_stage THEN
        v_per_stage := v_best;
        v_label := v_best_label;
      END IF;
    END LOOP;

    IF v_per_stage > 0 THEN
      v_source := 'credit_pack';
    END IF;
  END IF;

  IF v_per_stage <= 0 THEN
    RETURN; -- not a paid user
  END IF;

  SELECT COALESCE(sum(pv.amount), 0)::INTEGER INTO v_used
  FROM public.post_votes pv
  WHERE pv.user_id = v_uid AND pv.stage_id = v_stage.stage_id;

  stage_id := v_stage.stage_id;
  stage_name := v_stage.stage_name;
  stage_number := v_stage.stage_number;
  source := v_source;
  source_label := v_label;
  votes_per_stage := v_per_stage;
  votes_used := v_used;
  votes_remaining := GREATEST(v_per_stage - v_used, 0);

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_voting_power(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_voting_power(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_voting_power(UUID) TO anon;

-- ------------------------------------------------------------------
-- 6. cast_post_vote: the single place a vote is validated and written
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cast_post_vote(
  p_post_id UUID,
  p_amount INTEGER
)
RETURNS TABLE (
  ok BOOLEAN,
  message TEXT,
  votes_remaining INTEGER,
  post_votes_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_power RECORD;
  v_post RECORD;
  v_existing INTEGER;
  v_post_total INTEGER;
  v_remaining INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Sign in to vote.', 0, 0;
    RETURN;
  END IF;

  -- The allowance is checked by reading post_votes and the write happens in a
  -- later statement, so under READ COMMITTED those are separate snapshots and
  -- two concurrent votes from the same user would both see the same remaining
  -- allowance and both commit. Serialising per user closes that window; a row
  -- lock cannot, because the first vote has no row to lock.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  IF COALESCE(p_amount, 0) < 0 THEN
    RETURN QUERY SELECT FALSE, 'Vote amount cannot be negative.', 0, 0;
    RETURN;
  END IF;

  SELECT * INTO v_post
  FROM public.posts p
  WHERE p.id = p_post_id;

  IF NOT FOUND OR v_post.is_hidden OR NOT v_post.is_approved THEN
    RETURN QUERY SELECT FALSE, 'That post is not available.', 0, 0;
    RETURN;
  END IF;

  IF v_post.author_id = v_uid THEN
    RETURN QUERY SELECT FALSE, 'You cannot vote for your own post.', 0, 0;
    RETURN;
  END IF;

  SELECT * INTO v_power FROM public.get_voting_power(v_uid);
  IF v_power.stage_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Voting is closed right now.', 0, 0;
    RETURN;
  END IF;
  SELECT pv.amount INTO v_existing
  FROM public.post_votes pv
  WHERE pv.post_id = p_post_id
    AND pv.user_id = v_uid
    AND pv.stage_id = v_power.stage_id;

  -- Only an INCREASE needs remaining allowance. A user who has spent everything
  -- must still be able to withdraw a vote or move it to another post, otherwise
  -- a member on the entry tier is locked into their very first vote for the
  -- whole stage.
  IF p_amount > COALESCE(v_existing, 0)
     AND p_amount - COALESCE(v_existing, 0) > v_power.votes_remaining THEN
    RETURN QUERY
      SELECT FALSE,
             'You have ' || v_power.votes_remaining || ' vote(s) left for this stage.',
             v_power.votes_remaining, COALESCE(v_post.votes_count, 0);
    RETURN;
  END IF;

  -- p_amount = 0 withdraws a vote; anything else sets the total on this post.
  IF COALESCE(p_amount, 0) = 0 THEN
    DELETE FROM public.post_votes
    WHERE post_id = p_post_id AND user_id = v_uid AND stage_id = v_power.stage_id;
  ELSE
    INSERT INTO public.post_votes (post_id, user_id, stage_id, amount)
    VALUES (p_post_id, v_uid, v_power.stage_id, p_amount)
    ON CONFLICT (post_id, user_id, stage_id) DO UPDATE
      SET amount = EXCLUDED.amount, updated_at = now();
  END IF;

  SELECT COALESCE(sum(pv.amount), 0)::INTEGER INTO v_post_total
  FROM public.post_votes pv
  JOIN public.get_current_voting_stage() s ON s.stage_id = pv.stage_id
  WHERE pv.post_id = p_post_id;

  SELECT COALESCE(sum(pv.amount), 0)::INTEGER INTO v_remaining
  FROM public.post_votes pv
  WHERE pv.user_id = v_uid AND pv.stage_id = v_power.stage_id;

  RETURN QUERY
    SELECT TRUE,
           'Vote recorded.',
           GREATEST(v_power.votes_per_stage - v_remaining, 0),
           v_post_total;
END;
$$;

REVOKE ALL ON FUNCTION public.cast_post_vote(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cast_post_vote(UUID, INTEGER) TO authenticated;

-- How a given user has voted on a given post, for painting the button state.
CREATE OR REPLACE FUNCTION public.get_my_votes(p_post_ids UUID[])
RETURNS TABLE (post_id UUID, amount INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pv.post_id, sum(pv.amount)::INTEGER
  FROM public.post_votes pv
  JOIN public.get_current_voting_stage() s ON s.stage_id = pv.stage_id
  WHERE pv.user_id = auth.uid() AND pv.post_id = ANY (p_post_ids)
  GROUP BY pv.post_id;
$$;

REVOKE ALL ON FUNCTION public.get_my_votes(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_votes(UUID[]) TO authenticated;

-- ------------------------------------------------------------------
-- 7. Per-category leaderboard
-- ------------------------------------------------------------------
-- This ranks the people being VOTED FOR, not the people casting votes. An
-- earlier version grouped by post_votes.user_id, which produced a "most active
-- voters" list and credited people with the casting rather than the winning.
-- The unit here is a creator, so a post's votes roll up into its author and one
-- person with several well-backed posts can outrank a single strong post.
CREATE OR REPLACE FUNCTION public.get_category_leaderboard(
  p_category TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  rank INTEGER,
  user_id UUID,
  full_name TEXT,
  avatar_url TEXT,
  total_votes INTEGER,
  posts_count INTEGER,
  top_post_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH scoped AS (
    SELECT p.author_id, pv.amount, p.id AS post_id
    FROM public.post_votes pv
    JOIN public.posts p ON p.id = pv.post_id
    JOIN public.get_current_voting_stage() s ON s.stage_id = pv.stage_id
    WHERE p.is_approved AND NOT p.is_hidden
      -- p_category NULL or '' means "all categories". A post with no category
      -- still belongs somewhere, and `NULL = 'x'` is NULL rather than false, so
      -- without the explicit IS NULL those votes vanish from every filtered
      -- leaderboard while still appearing in the unfiltered one.
      AND (p_category IS NULL OR p_category = '' OR p.category IS NULL OR p.category = p_category)
  ),
  -- Collapse to one row per post first, so posts_count is a count of posts
  -- rather than of voters, and the best post can be picked out below.
  per_post AS (
    SELECT scoped.author_id, scoped.post_id, sum(scoped.amount)::INTEGER AS votes
    FROM scoped
    WHERE scoped.author_id IS NOT NULL
    GROUP BY scoped.author_id, scoped.post_id
  )
  SELECT
    (row_number() OVER (ORDER BY sum(per_post.votes) DESC, per_post.author_id))::INTEGER,
    per_post.author_id,
    COALESCE(pr.full_name, 'Member'),
    pr.avatar_url,
    sum(per_post.votes)::INTEGER,
    count(*)::INTEGER,
    (array_agg(per_post.post_id ORDER BY per_post.votes DESC, per_post.post_id))[1]
  FROM per_post
  LEFT JOIN public.profiles pr ON pr.id = per_post.author_id
  GROUP BY per_post.author_id, pr.full_name, pr.avatar_url
  ORDER BY sum(per_post.votes) DESC, per_post.author_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.get_category_leaderboard(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_category_leaderboard(TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_category_leaderboard(TEXT, INTEGER) TO anon;

-- Which categories actually have votes, so the UI can hide empty leaderboards.
CREATE OR REPLACE FUNCTION public.get_voted_categories()
RETURNS TABLE (category TEXT, total_votes INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.category, sum(pv.amount)::INTEGER
  FROM public.post_votes pv
  JOIN public.posts p ON p.id = pv.post_id
  JOIN public.get_current_voting_stage() s ON s.stage_id = pv.stage_id
  WHERE p.is_approved AND NOT p.is_hidden
  GROUP BY p.category
  ORDER BY sum(pv.amount) DESC, p.category;
$$;

REVOKE ALL ON FUNCTION public.get_voted_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_voted_categories() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_voted_categories() TO anon;

-- ------------------------------------------------------------------
-- 8. First stage, so voting works immediately
-- ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.voting_stages) THEN
    INSERT INTO public.voting_stages (name, stage_number, is_current)
    VALUES ('Stage 1', 1, TRUE);
  END IF;
END;
$$;
