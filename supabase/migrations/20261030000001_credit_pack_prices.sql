-- Credit pack pricing update — 2026-10-30
-- Starter ₦2,720 · Standard ₦10,880 · Annual ₦43,520
-- Credits and validity periods are unchanged.

UPDATE public.audit_credit_packs
SET price = 2720
WHERE name ILIKE '%starter%';

UPDATE public.audit_credit_packs
SET price = 10880
WHERE name ILIKE '%standard%';

UPDATE public.audit_credit_packs
SET price = 43520
WHERE name ILIKE '%annual%';
