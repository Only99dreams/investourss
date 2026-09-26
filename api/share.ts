import type { VercelRequest, VercelResponse } from "@vercel/node";

// These must come from the environment. This used to fall back to a hardcoded
// Supabase project, which pointed at the wrong database: every post lookup
// missed, and the handler responded with a 302 redirect. A redirect carries no
// og: tags at all, so shared links had no title, no thumbnail and no pitch,
// and the failure was invisible. If the config is missing we now say so instead
// of silently reading from the wrong place.
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";
const SITE_URL = process.env.SITE_URL || "https://investours.app";
const DEFAULT_IMAGE = `${SITE_URL}/logo.png`;

function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Link-preview crawlers.
 *
 * These must be served the og: tags and NOT be redirected. A
 * `<meta http-equiv="refresh">` looks inert, but WhatsApp, Facebook and several
 * others follow it: they would fetch this page, read the correct og:image, then
 * follow the refresh to /community, get the SPA shell, and re-read the tags from
 * index.html - which carries the Investours logo. That is why every og: fix
 * appeared to do nothing. A person following the link still gets forwarded.
 */
const CRAWLER_UA =
  /facebookexternalhit|facebookcatalog|facebot|whatsapp|twitterbot|linkedinbot|slackbot|slack-imgproxy|discordbot|telegrambot|skypeuripreview|applebot|redditbot|embedly|pinterest|quora|vkshare|w3c_validator|bot\b|crawler|spider|preview/i;

function isLinkPreviewCrawler(userAgent: string): boolean {
  if (!userAgent) return false;
  // A real browser never matches: the pattern deliberately avoids bare
  // substrings that appear in Chrome, Safari or the WhatsApp in-app browser
  // (whose UA says "MicroMessenger", not "WhatsApp").
  if (/mozilla/i.test(userAgent) && !/bot|crawler|spider|preview/i.test(userAgent)) {
    // Still allow explicitly-named crawlers that also send a Mozilla token.
    return CRAWLER_UA.test(userAgent);
  }
  return CRAWLER_UA.test(userAgent);
}

/**
 * Does a public storage object exist?
 *
 * A HEAD is enough and avoids pulling the image down. Bounded by a short
 * timeout: this runs inside a link preview, and a share with no thumbnail is a
 * far better outcome than one that never renders because a HEAD hung.
 */
async function objectExists(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const postId = req.query.post as string;
  const ref = (req.query.ref as string) || "";

  if (!postId) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).send(
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
        `<title>Link unavailable</title></head><body>` +
        `<p>This share link is incomplete. ` +
        `<a href="${escapeHtml(`${SITE_URL}/community`)}">Browse the community</a>.</p>` +
        `</body></html>`,
    );
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // Previously this was papered over with a hardcoded fallback pointing at a
    // different project, so a misconfigured deployment looked exactly like a
    // missing post: a 302, and therefore no og: tags at all.
    console.error(
      "[api/share] Missing Supabase configuration. Set SUPABASE_URL and " +
        "SUPABASE_ANON_KEY (or the VITE_-prefixed equivalents) on the server.",
    );
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).send(
      `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
        `<title>Share link unavailable</title></head><body>` +
        `<h1>Share link unavailable</h1>` +
        `<p>This share link is temporarily misconfigured. ` +
        `<a href="${escapeHtml(`${SITE_URL}/community`)}">Visit the community</a>.</p>` +
        `</body></html>`,
    );
  }

  const communityUrl = `${SITE_URL}/community?post=${postId}${ref ? `&ref=${ref}` : ""}`;

  try {
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    const postRes = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=content,category,attachment_url,attachment_type,author_id,likes_count,comments_count`,
      { headers }
    );

    if (!postRes.ok) {
      console.error(`[api/share] Post lookup failed: ${postRes.status} ${await postRes.text()}`);
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).send(
        `<!DOCTYPE html><html><head><meta charset="utf-8" />` +
          `<title>Share link unavailable</title></head><body>` +
          `<h1>Share link unavailable</h1>` +
          `<p>We could not load this post. ` +
          `<a href="${escapeHtml(`${SITE_URL}/community`)}">Visit the community</a>.</p>` +
          `</body></html>`,
      );
    }

    const posts = await postRes.json();
    const post = Array.isArray(posts) ? posts[0] : null;

    if (!post) {
      // A genuine miss: the post is gone, unapproved or hidden by RLS.
      //
      // This used to redirect to /community, and that turned out to be the worst
      // available answer: the edge resolved the redirect and served the SPA
      // shell, whose index.html carries the Investours logo. A crawler got a
      // 200 with a branded image and no way to tell the post had gone, which is
      // indistinguishable from "sharing is broken". A 410 is both honest and
      // cacheable, and it never reaches the logo.
      console.warn(`[api/share] No visible post for id ${postId}`);
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(410).send(
        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
          `<title>Post unavailable</title>` +
          `<meta name="robots" content="noindex" /></head><body>` +
          `<h1>This post is no longer available</h1>` +
          `<p>It may have been removed by its author or hidden by a moderator. ` +
          `<a href="${escapeHtml(`${SITE_URL}/community`)}">Browse the community</a>.</p>` +
          `</body></html>`,
      );
    }

    let authorName = "Investours Member";
    try {
      const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${post.author_id}&select=full_name`,
        { headers }
      );
      const profiles = await profileRes.json();
      if (profiles?.[0]?.full_name) {
        authorName = profiles[0].full_name;
      }
    } catch {
      // use default
    }

    const contentPreview = (post.content || "").substring(0, 200);
    const likesCount = post.likes_count || 0;
    const commentsCount = post.comments_count || 0;

    const ogTitle = `${authorName} shared a post on Investours Opportunity Hub`;

    // Investours Idea Competition entries get the competition pitch in the
    // link preview. Matched loosely because the admin-defined slug may be
    // 'aiwc', 'aiwc_competition', and so on. This condensed string is kept in
    // step by hand with src/lib/share.ts - this function is bundled separately
    // by Vercel and cannot import from src/.
    const rawCategory = (post.category || "").trim().toLowerCase();
    const compactCategory = rawCategory.replace(/[\s_.-]+/g, "");
    const isAiwc =
      rawCategory.includes("aiwc") ||
      compactCategory === "ideacompetition" ||
      compactCategory === "competition";
    const ogDescription = isAiwc
      ? "I’m competing in the Investours Idea Competition! Voting is open to eligible " +
        "Premium subscribers, with voting power determined by their plan. Premium " +
        "starts from ₦1,700."
      : contentPreview
        ? `${contentPreview}${contentPreview.length >= 200 ? "..." : ""} — ${likesCount} likes, ${commentsCount} comments`
        : "Check out this opportunity on Investours";
    // Poster frame for the preview, resolved independently of the category so
    // every post gets its own media:
    //   - an image post uses its own picture
    //   - a YouTube/Vimeo link yields a deterministic provider thumbnail
    //   - an uploaded video has a frame stored next to it, named by convention
    //     (`123.mp4` -> `123-thumb.jpg`) so it can be found without a new
    //     column or a backfill job. That candidate is confirmed with a HEAD:
    //     videos uploaded before frames existed have none, and a broken image
    //     in a preview is worse than the branded card.
    // Mirrors src/lib/video.ts and src/lib/videoThumbnail.ts, which this
    // function cannot import because Vercel bundles it separately.
    const attachmentUrl = post.attachment_url || null;
    let posterFromVideo: string | null = null;
    if (post.attachment_type === "video" && attachmentUrl) {
      try {
        const parsed = new URL(attachmentUrl);
        const host = parsed.hostname.toLowerCase();
        const isYoutube =
          host === "youtu.be" ||
          host.endsWith("youtube.com") ||
          host.endsWith("youtube-nocookie.com");
        if (isYoutube) {
          const segments = parsed.pathname.split("/").filter(Boolean);
          const id =
            parsed.searchParams.get("v") ||
            (host === "youtu.be" || host === "www.youtu.be"
              ? segments[0]
              : ["embed", "shorts", "live"].includes(segments[0])
                ? segments[1]
                : null);
          if (id) posterFromVideo = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        } else if (host.endsWith("vimeo.com")) {
          const id = parsed.pathname.split("/").filter((s) => /^\d+$/.test(s)).pop();
          if (id) posterFromVideo = `https://thumbnail.com/${id}.jpg`;
        } else if (/\.(mp4|m4v|webm|ogv|mov)$/i.test(parsed.pathname)) {
          const candidate = new URL(attachmentUrl);
          candidate.pathname = candidate.pathname.replace(
            /\.(mp4|m4v|webm|ogv|mov)$/i,
            "-thumb.jpg",
          );
          if (await objectExists(candidate.toString())) posterFromVideo = candidate.toString();
        }
      } catch {
        posterFromVideo = null;
      }
    }

    const ogImage =
      (post.attachment_type === "image" && attachmentUrl) ||
      posterFromVideo ||
      DEFAULT_IMAGE;
    const ogImageAlt = ogImage !== DEFAULT_IMAGE
      ? `Media from ${authorName}'s post on Investours`
      : "Investours - AI Financial Auditor";

    // Dimensions per source. WhatsApp and Facebook use these to build the card,
    // and a missing or wrong pair is a common reason a preview renders as a
    // small thumbnail or not at all. They were previously hardcoded to 1200x630
    // for whatever image happened to be set, which misdescribed a 480x360 YouTube
    // poster. Only asserted where the size is actually known: a user's own image
    // can be any size, and guessing is worse than omitting.
    let ogImageWidth = "";
    let ogImageHeight = "";
    if (ogImage === DEFAULT_IMAGE) {
      ogImageWidth = "1200";
      ogImageHeight = "630";
    } else if (/i\.ytimg\.com/.test(ogImage)) {
      ogImageWidth = "480";
      ogImageHeight = "360";
    } else if (/thumbnail\.com/.test(ogImage)) {
      ogImageWidth = "1280";
      ogImageHeight = "720";
    } else if (/-thumb\.jpg$/.test(ogImage)) {
      // A captured frame keeps the video's own dimensions, which are unknown here.
      ogImageWidth = "1280";
      ogImageHeight = "720";
    }
    // A user's own upload is left unasserted on purpose.

    // og:url must be the URL whose tags these are. Pointing it at the community
    // deep link makes the SPA shell the canonical URL, and a crawler that
    // re-fetches that gets index.html - which carries the Investours logo. The
    // community link is still offered as the destination to go to.
    const canonicalUrl = `${SITE_URL}/api/share?post=${encodeURIComponent(postId)}${
      ref ? `&ref=${encodeURIComponent(ref)}` : ""
    }`;

    // Only a person gets forwarded to the post. A crawler that followed the
    // redirect would land on the SPA shell and re-read the tags from index.html,
    // which is how a correct og:image still ended up rendering as the logo.
    const forwardToPost = !isLinkPreviewCrawler(String(req.headers["user-agent"] ?? ""));

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(ogTitle)}</title>

  <meta property="og:title" content="${escapeHtml(ogTitle)}" />
  <meta property="og:description" content="${escapeHtml(ogDescription)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:image:alt" content="${escapeHtml(ogImageAlt)}" />
${ogImageWidth ? `  <meta property="og:image:width" content="${ogImageWidth}" />\n  <meta property="og:image:height" content="${ogImageHeight}" />\n` : ""}  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Investours" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@investours" />
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
${forwardToPost ? `  <meta http-equiv="refresh" content="0;url=${escapeHtml(communityUrl)}" />
  <script>window.location.replace("${escapeHtml(communityUrl)}");</script>
</head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,sans-serif;background:#f9fafb;">
  <div style="text-align:center;padding:2rem;">
    <h2 style="margin-bottom:1rem;">Investours Opportunity Hub</h2>
    <p style="color:#6b7280;margin-bottom:1.5rem;">Taking you to the post...</p>
    <a href="${escapeHtml(communityUrl)}" style="color:#2563eb;text-decoration:underline;">Click here if not redirected</a>
  </div>
</body>
</html>` : `</head>
<body>
  <a href="${escapeHtml(communityUrl)}">View this post on Investours</a>
</body>
</html>`}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    return res.status(200).send(html);
  } catch (error) {
    console.error("Share handler error:", error);
    return res.redirect(302, `${SITE_URL}/community`);
  }
}
