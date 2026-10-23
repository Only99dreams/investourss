-- ============================================================
-- Subscription voting power refresh
-- ============================================================
--
-- Credit pack voting power is unchanged:
--   starter 1, standard 2, annual 3
--
-- Subscription voting power is increased:
--   monthly   2  (was 1)
--   quarterly 4  (was 2)
--   biennial  6  (was 3)
--   annual    8  (was 4)
--
-- B2B rows are intentionally left as they are; this change only covers the
-- consumer subscription tiers listed above.
--
-- get_voting_power reads votes_per_stage from this table, so updating the rows
-- is enough - no function change is required. Idempotent and safe to re-run.

INSERT INTO public.voting_power_tiers (source, plan_key, label, votes_per_stage, sort_order)
VALUES
  ('subscription', 'monthly',   'Monthly',   2, 1),
  ('subscription', 'quarterly', 'Quarterly', 4, 2),
  ('subscription', 'biennial',  'Bi-Annual', 6, 3),
  ('subscription', 'annual',    'Annual',    8, 4)
ON CONFLICT (source, plan_key) DO UPDATE
  SET label = EXCLUDED.label,
      votes_per_stage = EXCLUDED.votes_per_stage,
      sort_order = EXCLUDED.sort_order;
