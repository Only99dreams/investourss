/**
 * Poster frames for uploaded video files.
 *
 * Link videos (YouTube, Vimeo) get their poster from the provider, but an
 * uploaded file has no such luck: the only way to see it is to decode the video
 * and grab a frame, which needs a browser. This module does that and writes the
 * result next to the video under a name both ends can compute independently,
 * so the share endpoint - fetched by crawlers with no browser at all - has
 * something to show.
 *
 * Both post composers use these helpers, which is why the home page section and
 * the community page cannot drift apart on this.
 */

import { supabase } from "@/integrations/supabase/client";
import { generateVideoThumbnail } from "@/lib/utils";
import { dataUrlToBlob, siblingThumbnailUrl, videoThumbPath } from "@/lib/video";

const THUMB_BUCKET = "attachments";

/** Public URL of a stored path, or null if the URL cannot be built. */
function publicUrlForPath(path: string): string | null {
  const { data } = supabase.storage.from(THUMB_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

/** Storage path portion of a public object URL, or null if it isn't one. */
function pathFromPublicUrl(publicUrl: string): string | null {
  try {
    const parsed = new URL(publicUrl);
    const marker = "/object/public/";
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}

/**
 * The already-stored frame for a video, or null when there is none.
 *
 * Preferring the stored frame keeps the in-page card and the shared preview
 * showing the same image, and costs one HEAD rather than a decode. The share
 * endpoint uses this same lookup, which is why a poster generated here shows up
 * there with no column to keep in sync.
 */
export async function storedThumbnailFor(videoPublicUrl: string): Promise<string | null> {
  const candidate = siblingThumbnailUrl(videoPublicUrl);
  if (!candidate) return null;
  try {
    const res = await fetch(candidate, { method: "HEAD" });
    return res.ok ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Capture a frame from a stored video and save it beside the video.
 *
 * Reading the remote object directly is safe here: the bucket serves
 * `Access-Control-Allow-Origin: *` and `Accept-Ranges: bytes`, so the canvas is
 * not tainted and only the byte range around the seek is fetched. This is what
 * rescues videos uploaded before frames were stored.
 *
 * Callers must confirm the viewer is the post author before calling: writing to
 * storage is privileged and must not be available to any reader of the feed.
 *
 * Never throws - a missing poster only degrades the share preview, it must not
 * surface as an error on a post that is otherwise fine.
 */
export async function backfillVideoThumbnail(videoPublicUrl: string): Promise<string | null> {
  if (await storedThumbnailFor(videoPublicUrl)) return null;

  const target = siblingThumbnailUrl(videoPublicUrl);
  const path = target ? pathFromPublicUrl(target) : null;
  if (!target || !path) return null;

  try {
    const dataUrl = await generateVideoThumbnail(videoPublicUrl);
    if (!dataUrl) return null;

    const blob = await dataUrlToBlob(dataUrl);
    if (!blob || blob.size === 0) return null;

    const { error } = await supabase.storage
      .from(THUMB_BUCKET)
      .upload(path, blob, { cacheControl: "3600", upsert: true, contentType: "image/jpeg" });

    if (error) {
      console.warn("Video thumbnail backfill failed:", error.message);
      return null;
    }
    return publicUrlForPath(path) ?? target;
  } catch (error) {
    console.warn("Video thumbnail backfill skipped:", error);
    return null;
  }
}

/**
 * Capture a frame from a just-picked local file and store it beside the video.
 *
 * Uses a local blob: URL so the capture cannot be blocked by CORS at all. The
 * frame is captured before the post is inserted, so a brand new post always has
 * a poster - `backfillVideoThumbnail` only ever has to deal with older posts.
 */
export async function attachThumbnailToUpload(
  file: File,
  videoPath: string,
): Promise<string | null> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const dataUrl = await generateVideoThumbnail(objectUrl);
    if (!dataUrl) return null;

    const blob = await dataUrlToBlob(dataUrl);
    if (!blob || blob.size === 0) return null;

    const thumbPath = videoThumbPath(videoPath);
    const { error } = await supabase.storage
      .from(THUMB_BUCKET)
      .upload(thumbPath, blob, { cacheControl: "3600", upsert: true, contentType: "image/jpeg" });

    if (error) {
      console.warn("Video thumbnail upload failed:", error.message);
      return null;
    }
    return publicUrlForPath(thumbPath);
  } catch (error) {
    console.warn("Video thumbnail capture skipped:", error);
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
