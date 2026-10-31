-- ============================================================
-- Bookmaker media privacy
-- ============================================================
-- Covers and narration belong to a single member's book. Both buckets were
-- created as public, so their object URLs bypassed row-level security: anyone
-- holding a URL, or listing the bucket through the storage API, could read
-- another member's book art and audio.
--
-- Make the buckets private and allow reads only from the owning folder. The
-- app resolves short-lived signed URLs instead; narration previews are signed
-- by the bookmaker edge function with the service role.

UPDATE storage.buckets
SET public = FALSE
WHERE id IN ('bookmaker-covers', 'bookmaker-audio');

DROP POLICY IF EXISTS "Bookmaker covers are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Bookmaker audio is publicly readable" ON storage.objects;

DROP POLICY IF EXISTS "Owners read own bookmaker covers" ON storage.objects;
CREATE POLICY "Owners read own bookmaker covers"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bookmaker-covers'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS "Owners read own bookmaker audio" ON storage.objects;
CREATE POLICY "Owners read own bookmaker audio"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'bookmaker-audio'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );
