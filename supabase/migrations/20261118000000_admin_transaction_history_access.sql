-- Admin read access for the Admin > Transaction History ledger.
-- The existing member-facing policies remain; these add the admin SELECT paths
-- for payment ledgers and audiobook spends that were previously owner-only.

DROP POLICY IF EXISTS "Admins view all subscription payments" ON public.subscription_payments;
CREATE POLICY "Admins view all subscription payments"
  ON public.subscription_payments FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins view all audit pack payments" ON public.audit_pack_payments;
CREATE POLICY "Admins view all audit pack payments"
  ON public.audit_pack_payments FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins read all audiobook downloads" ON public.bookmaker_audio_downloads;
CREATE POLICY "Admins read all audiobook downloads"
  ON public.bookmaker_audio_downloads FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));
