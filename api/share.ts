import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Legacy share endpoint: /api/share?post=<id>
 *
 * This used to render the sharing metadata itself, which made the API route a
 * second, competing canonical URL for every post: /api/share?post=<id> and
 * /post/<id> could each claim to be the post, and the duplicate copy of the
 * metadata logic drifted from the app's.
 *
 * It now permanently redirects to /post/<id>, which is the single canonical URL.
 * Old links keep working and crawlers follow the redirect to the real page.
 *
 * The legacy `ref` parameter is preserved so existing referral attribution
 * still lands, and `t` (a short-lived cache-busting token that used to be added
 * to shared links) is deliberately dropped rather than propagated: production
 * URLs must be deterministic.
 */

const SITE_URL = (process.env.SITE_URL || "https://investours.app").replace(/\/$/, "");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const postId = String(req.query.post ?? "").trim();
  const ref = String(req.query.ref ?? "").trim();

  // Only forward a well-formed id into the path. Anything else is not a post.
  if (!postId || !UUID.test(postId)) {
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, `${SITE_URL}/community`);
  }

  const target =
    `${SITE_URL}/post/${encodeURIComponent(postId)}` +
    (ref ? `?ref=${encodeURIComponent(ref)}` : "");

  // 301: the destination is permanent and there is nothing to vary on.
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.redirect(301, target);
}
