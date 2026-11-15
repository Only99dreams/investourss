-- ============================================================
-- Premium plan refresh + Bookmaker plan allowances
-- ============================================================
-- 1) Public Premium plan pricing (effective 2026-11-15):
--      monthly    N38,250   (1-month plan,  4 ebooks)
--      quarterly  N102,000  (3-month plan,  8 ebooks)
--      biennial   N191,250  (6-month plan, 16 ebooks)
--      annual     N382,500  (12-month plan, 32 ebooks)
--      b2b prices are unchanged.
--
-- 2) Bookmaker plan allowances now line up with the advertised ebook counts,
--    and the included credit grant covers that many long books (6 credits
--    each). A subscriber can therefore write the promised number of ebooks
--    at any length using only their plan — top-up packs remain optional.
--
-- 3) `title_regeneration` is a free operation and must be priced at 0 so it
--    never reserves a credit. Unknown operations still default to 1.
-- ============================================================

-- ------------------------------------------------------------------
-- 1. Server-side price map
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.subscription_price_for_plan(p_plan_type TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_plan_type
    WHEN 'monthly'       THEN 38250
    WHEN 'quarterly'     THEN 102000
    WHEN 'biennial'      THEN 191250
    WHEN 'annual'        THEN 382500
    WHEN 'b2b_quarterly' THEN 360000
    WHEN 'b2b_annual'    THEN 120000
    ELSE 38250
  END::NUMERIC;
$$;

REVOKE ALL ON FUNCTION public.subscription_price_for_plan(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subscription_price_for_plan(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_price_for_plan(TEXT) TO anon;

-- ------------------------------------------------------------------
-- 2. Bookmaker operation costs (title regeneration is free)
-- ------------------------------------------------------------------
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
  ELSIF p_operation IN ('outline', 'export', 'title_regeneration') THEN
    RETURN 0;
  END IF;
  RETURN 1;
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_operation_cost(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_operation_cost(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookmaker_operation_cost(TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------------
-- 3. Ebook creations included per subscription period
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bookmaker_plan_item_limit(p_type TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(COALESCE(p_type, ''))
    WHEN 'monthly' THEN 4
    WHEN 'quarterly' THEN 8
    WHEN 'biennial' THEN 16
    WHEN 'biannual' THEN 16
    WHEN 'bi-annual' THEN 16
    WHEN 'annual' THEN 32
    WHEN 'b2b_quarterly' THEN 6
    WHEN 'b2b_annual' THEN 24
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_plan_item_limit(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_plan_item_limit(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bookmaker_plan_item_limit(TEXT) TO service_role;

-- ------------------------------------------------------------------
-- 4. Included credits per period (one long book = 6 credits)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bookmaker_ensure_subscription_grant(p_user_id UUID)
RETURNS public.bookmaker_subscription_credits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile RECORD;
  v_active BOOLEAN;
  v_type TEXT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
  v_granted INTEGER;
  v_grant public.bookmaker_subscription_credits;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- A stale user_tier must not keep a lapsed plan alive. Access requires a
  -- live flag with no expiry, or an expiry that is still in the future.
  v_active :=
    (COALESCE(v_profile.has_active_subscription, FALSE)
      AND (v_profile.subscription_expires_at IS NULL OR v_profile.subscription_expires_at > now()))
    OR (v_profile.subscription_expires_at IS NOT NULL AND v_profile.subscription_expires_at > now());

  IF NOT v_active THEN
    RETURN NULL;
  END IF;

  v_type := COALESCE(v_profile.subscription_type, 'monthly');

  IF v_profile.subscription_expires_at IS NOT NULL AND v_profile.subscription_expires_at > now() THEN
    v_end := v_profile.subscription_expires_at;
    v_start := CASE v_type
      WHEN 'monthly' THEN v_end - INTERVAL '1 month'
      WHEN 'quarterly' THEN v_end - INTERVAL '3 months'
      WHEN 'biennial' THEN v_end - INTERVAL '6 months'
      WHEN 'annual' THEN v_end - INTERVAL '1 year'
      WHEN 'b2b_quarterly' THEN v_end - INTERVAL '3 months'
      WHEN 'b2b_annual' THEN v_end - INTERVAL '1 year'
      ELSE v_end - INTERVAL '1 month'
    END;
  ELSE
    -- Tier-based access without a stored expiry: use a rolling calendar month.
    v_start := date_trunc('month', now());
    v_end := date_trunc('month', now()) + INTERVAL '1 month';
    v_type := COALESCE(v_profile.subscription_type, 'monthly');
  END IF;

  -- Grant enough included credits for the plan's full ebook allowance at the
  -- longest book price (6 credits), so the advertised count is always usable.
  v_granted := CASE v_type
    WHEN 'monthly' THEN 24
    WHEN 'quarterly' THEN 48
    WHEN 'biennial' THEN 96
    WHEN 'annual' THEN 192
    WHEN 'b2b_quarterly' THEN 36
    WHEN 'b2b_annual' THEN 144
    ELSE 24
  END;

  INSERT INTO public.bookmaker_subscription_credits
    (user_id, subscription_type, period_start, period_end, credits_granted)
  VALUES
    (p_user_id, v_type, v_start, v_end, v_granted)
  ON CONFLICT (user_id, period_start, period_end) DO UPDATE
    SET subscription_type = EXCLUDED.subscription_type,
        credits_granted = GREATEST(
          public.bookmaker_subscription_credits.credits_granted,
          EXCLUDED.credits_granted
        )
  RETURNING * INTO v_grant;

  RETURN v_grant;
END;
$$;

REVOKE ALL ON FUNCTION public.bookmaker_ensure_subscription_grant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bookmaker_ensure_subscription_grant(UUID) TO service_role;

-- ------------------------------------------------------------------
-- 5. Give live subscribers the new allowance immediately
-- ------------------------------------------------------------------
-- Without this, an account already inside its current period would keep the
-- old (too-small) grant until its next renewal.
UPDATE public.bookmaker_subscription_credits
SET credits_granted = GREATEST(
  credits_granted,
  CASE subscription_type
    WHEN 'monthly' THEN 24
    WHEN 'quarterly' THEN 48
    WHEN 'biennial' THEN 96
    WHEN 'annual' THEN 192
    WHEN 'b2b_quarterly' THEN 36
    WHEN 'b2b_annual' THEN 144
    ELSE 24
  END
)
WHERE period_end > now();
