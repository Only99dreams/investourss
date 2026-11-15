-- User types are now Individual, Business and B2B Subscriber. The 2025 enum
-- only had individual/group/firm, so add the new values first. New enum values
-- cannot be used in the same transaction that adds them, hence the separate
-- backfill migration that follows this one.

ALTER TYPE public.user_type ADD VALUE IF NOT EXISTS 'business';
ALTER TYPE public.user_type ADD VALUE IF NOT EXISTS 'b2b';
