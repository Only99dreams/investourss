-- ============================================================
-- Harden payments + make category-specific stages actually work
-- ============================================================
--
-- Fixes four issues found while auditing voting and credit purchases:
--
--   1. Payment activation was callable directly by any signed-in user, so
--      anyone could grant themselves credits or a premium subscription (and
--      therefore free voting power) with a fabricated reference. The RPCs are
--      now service-role only; the client goes through the verified
--      `verify-payment` edge function, which checks the charge with Paystack.
--
--   2. A leftover global unique index (idx_voting_stages_single_current) made
--      it impossible to run more than one category's stage at a time, which
--      defeated the category-specific stages migration.
--
--   3. posts.votes_count was still computed against the global stage instead
--      of the post's own category, so it would desync once category stages
--      were used.
--
--   4. B2B plans had no voting tier, so a paying B2B customer could not vote.
--
-- Also hardens activate_free_subscription, which accepted any promo id and
-- any user id, letting a caller mint a free premium subscription.
--
-- Idempotent and safe to re-run.

-- ------------------------------------------------------------------
-- 1. One current stage PER CATEGORY (not one globally)
-- ------------------------------------------------------------------
-- The old index allowed only a single is_current row across the whole table.
-- COALESCE(category, '__global__') treats a NULL (legacy global) stage as its
-- own group, because NULLs compare as distinct in a plain unique index and
-- would otherwise let several global current stages coexist.
DROP INDEX IF EXISTS public.idx_voting_stages_single_current;

CREATE UNIQUE INDEX IF NOT EXISTS idx_voting_stages_one_current_per_category
  ON public.voting_stages ((COALESCE(category, '__global__')))
  WHERE is_current;

-- ------------------------------------------------------------------
-- 2. votes_count follows the post's own category
-- ------------------------------------------------------------------
-- The trigger used the category-less get_current_voting_stage(), so with
-- category stages open a post's count would be measured against the wrong
-- stage. Scope the lookup to the post's category.
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

  -- Recomputed with sum() rather than +1/-1 so it is idempotent and
  -- self-healing when a vote amount is changed.
  UPDATE public.posts p
  SET votes_count = COALESCE((
        SELECT sum(pv.amount)::INTEGER
        FROM public.post_votes pv
        JOIN public.get_current_voting_stage(p.category) s ON s.stage_id = pv.stage_id
        WHERE pv.post_id = v_post_id
      ), 0)
  WHERE p.id = v_post_id;

  RETURN NULL;
END;
$$;

-- Full recompute so existing counters match the category-scoped definition.
UPDATE public.posts p
SET votes_count = COALESCE((
      SELECT sum(pv.amount)::INTEGER
      FROM public.post_votes pv
      JOIN public.get_current_voting_stage(p.category) s ON s.stage_id = pv.stage_id
      WHERE pv.post_id = p.id
    ), 0);

-- ------------------------------------------------------------------
-- 3. B2B voting tiers
-- ------------------------------------------------------------------
-- B2B customers pay the most but had no tier row, so get_voting_power
-- returned no row and they saw "not a paid member". Both B2B plans get the
-- top allowance; tune the numbers here if the business decides otherwise.
INSERT INTO public.voting_power_tiers (source, plan_key, label, votes_per_stage, sort_order)
VALUES
  ('subscription', 'b2b_quarterly', 'B2B Quarterly', 4, 5),
  ('subscription', 'b2b_annual',    'B2B Annual',    4, 6)
ON CONFLICT (source, plan_key) DO UPDATE
  SET label = EXCLUDED.label,
      votes_per_stage = EXCLUDED.votes_per_stage,
      sort_order = EXCLUDED.sort_order;

-- get_voting_power: resolve B2B plans to their own tier instead of leaving
-- b2b_quarterly unmatched (and b2b_annual collapsed onto the consumer annual
-- tier). Recreated in full because a plpgsql body cannot be patched in place.
CREATE OR REPLACE FUNCTION public.get_voting_power(p_user_id UUID DEFAULT NULL, p_category TEXT DEFAULT NULL)
RETURNS TABLE (
  stage_id UUID,
  stage_name TEXT,
  stage_number INTEGER,
  stage_category TEXT,
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

  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN;
  END IF;

  SELECT * INTO v_stage FROM public.get_current_voting_stage(p_category);
  IF v_stage.stage_id IS NULL THEN
    RETURN; -- no open stage: voting is closed
  END IF;

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
    -- b2b_annual and b2b_quarterly now have their own tier rows, so they are
    -- looked up directly. A premium/exclusive tier granted with no recorded
    -- plan falls back to the entry-level allowance rather than nothing.
    v_sub_type := COALESCE(NULLIF(v_sub_type, ''), 'monthly');

    SELECT t.votes_per_stage, t.label INTO v_per_stage, v_label
    FROM public.voting_power_tiers t
    WHERE t.source = 'subscription' AND t.plan_key = v_sub_type;

    -- Unrecognised plan string: fall back to monthly so a live subscriber is
    -- not silently left without a vote.
    IF v_per_stage IS NULL OR v_per_stage <= 0 THEN
      SELECT t.votes_per_stage, t.label INTO v_per_stage, v_label
      FROM public.voting_power_tiers t
      WHERE t.source = 'subscription' AND t.plan_key = 'monthly';
    END IF;
  ELSE
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
  stage_category := v_stage.stage_category;
  source := v_source;
  source_label := v_label;
  votes_per_stage := v_per_stage;
  votes_used := v_used;
  votes_remaining := GREATEST(v_per_stage - v_used, 0);

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_voting_power(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_voting_power(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_voting_power(UUID, TEXT) TO anon;

-- ------------------------------------------------------------------
-- 4. Activation RPCs are service-role only
-- ------------------------------------------------------------------
-- These trusted the caller completely: any signed-in user could call them
-- with a made-up reference and grant themselves credits or premium. They are
-- now reachable only by trusted server code: the Paystack webhook and the
-- verify-payment edge function (both use the service role).
--
-- Guarded on existence so a database where an earlier migration left the
-- signatures slightly different does not fail the whole migration.
DO $$
BEGIN
  IF to_regprocedure('public.activate_paystack_subscription(uuid,text,text,integer,uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.activate_paystack_subscription(UUID, TEXT, TEXT, INTEGER, UUID) FROM authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.activate_paystack_subscription(UUID, TEXT, TEXT, INTEGER, UUID) TO service_role;
  END IF;

  IF to_regprocedure('public.activate_audit_pack_payment(uuid,text,integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.activate_audit_pack_payment(UUID, TEXT, INTEGER) FROM authenticated, anon;
    GRANT EXECUTE ON FUNCTION public.activate_audit_pack_payment(UUID, TEXT, INTEGER) TO service_role;
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- 5. Harden activate_free_subscription
-- ------------------------------------------------------------------
-- Previously accepted any p_user_id and any p_promo_code_id, minting free
-- premium with no validation. Now the caller can only activate for themselves
-- and only with a real, active, unused, 100%-off promo for the right plan.
CREATE OR REPLACE FUNCTION public.activate_free_subscription(
  p_user_id UUID,
  p_plan_type TEXT,
  p_promo_code_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo RECORD;
  v_admin_id UUID;
  v_uid UUID := auth.uid();
BEGIN
  -- A user may only activate their own free subscription. Server code using
  -- the service role (no auth.uid()) is allowed through.
  IF v_uid IS NOT NULL AND v_uid IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorised to activate this subscription'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_promo
  FROM public.promo_codes
  WHERE id = p_promo_code_id
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > now())
    AND discount_percentage = 100
    AND plan_type = p_plan_type;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This promo code is not valid for a free subscription.';
  END IF;

  IF v_promo.used_count >= v_promo.max_uses THEN
    RAISE EXCEPTION 'This promo code has reached its usage limit.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.promo_code_uses
    WHERE promo_code_id = p_promo_code_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'This promo code has already been used on this account.';
  END IF;

  SELECT id INTO v_admin_id FROM public.profiles
  WHERE role IN ('admin', 'super_admin')
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO public.promo_code_uses (promo_code_id, user_id, discount_applied, plan_type)
  VALUES (p_promo_code_id, p_user_id, 0, p_plan_type);

  UPDATE public.promo_codes
  SET used_count = used_count + 1
  WHERE id = p_promo_code_id;

  UPDATE public.profiles
  SET user_tier = 'premium',
      subscription_type = p_plan_type,
      has_active_subscription = TRUE,
      subscription_expires_at = public.subscription_expiry_for_plan(p_plan_type),
      updated_at = NOW()
  WHERE id = p_user_id;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.wallet_transactions (wallet_id, amount, transaction_type, narration, source, status, actor_id)
    SELECT w.id, 0, 'credit',
           CONCAT('Free Premium Subscription - ', p_plan_type, ' (100% discount)'),
           'subscription_payment', 'completed', v_admin_id
    FROM public.wallets w WHERE w.user_id = p_user_id;
  END IF;

  INSERT INTO public.notifications (user_id, title, message, type)
  VALUES (
    p_user_id,
    '🎉 Premium Subscription Activated!',
    CONCAT('Your premium subscription has been activated for free! You now have access to all premium features for the ', p_plan_type, ' plan.'),
    'subscription_activated'
  );

  RETURN TRUE;
END;
$$;

-- Stays callable by the member for their own subscription; the checks above are
-- what authorise it.
REVOKE ALL ON FUNCTION public.activate_free_subscription(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_free_subscription(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_free_subscription(UUID, TEXT, UUID) TO service_role;
