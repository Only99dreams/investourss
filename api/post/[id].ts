import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildPostMetadata,
  resolvePostPreviewImage,
  type ShareablePost,
} from "../../src/lib/postMetadata";

/**
 * The shareable page for a single post: /post/:id
 *
 * The site is a client-rendered SPA, and crawlers do not run JavaScript, so
 * every other URL - including /community?post=<id> - resolves to the static
 * index.html and advertises the site logo. This function exists so a post has
 * ONE canonical URL whose response actually contains the post.
 *
 * It server-renders the post text and media as well as the metadata, so the
 * page is useful with JavaScript disabled and the media is fetchable by a
 * crawler that only reads HTML.
 *
 * Security is unchanged. The post is read with the anon key, so the posts RLS
 * policy ("Anyone can view approved posts": is_approved AND NOT is_hidden)
 * decides what is visible. A post that is unapproved, hidden or missing is a 404
 * that reveals nothing, and its media URLs are never emitted.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";
const SITE_URL = (process.env.SITE_URL || "https://investours.app").replace(/\/$/, "");

/** Link-preview crawlers. Served the metadata with no redirect to follow. */
const CRAWLER_UA =
  /facebookexternalhit|facebookcatalog|facebot|whatsapp|twitterbot|linkedinbot|slackbot|slack-imgproxy|discordbot|telegrambot|skypeuripreview|applebot|redditbot|embedly|pinterest|quora|vkshare|bot\b|crawler|spider|preview/i;

function isCrawler(userAgent: string): boolean {
  if (!userAgent) return false;
  return CRAWLER_UA.test(userAgent);
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Escape a JSON string for embedding in a <script> block. */
function escapeJsonLd(json: string): string {
  // Only `<` needs neutralizing, so a "</script>" inside the data cannot close
  // the tag early. The value is already JSON and must NOT be stringified again:
  // that would wrap the object in quotes, making the whole block a JSON string,
  // which consumers reject.
  return json.replace(/</g, "\\u003c");
}

async function fetchPost(id: string): Promise<ShareablePost | null> {
  // Two queries, not an embed. There is no foreign key between posts and
  // profiles (both hang off auth.users), so PostgREST rejects
  // `profiles(full_name)` with PGRST200. This is the same two-step pattern the
  // community page already uses to resolve author names.
  const postRes = await fetch(
    `${SUPABASE_URL}/rest/v1/posts?id=eq.${encodeURIComponent(id)}` +
      `&select=id,content,category,attachment_url,attachment_type,created_at,likes_count,comments_count,author_id` +
      `&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  if (!postRes.ok) return null;
  const rows = await postRes.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];

  let authorName: string | null = null;
  if (row.author_id) {
    try {
      const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(row.author_id)}` +
          `&select=full_name&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      if (profileRes.ok) {
        const profiles = await profileRes.json();
        if (Array.isArray(profiles) && profiles[0]?.full_name) authorName = profiles[0].full_name;
      }
    } catch {
      // A missing author name must not fail the page; the metadata still works.
    }
  }

  return {
    id: row.id,
    content: row.content,
    category: row.category,
    attachment_url: row.attachment_url,
    attachment_type: row.attachment_type,
    created_at: row.created_at,
    likes_count: row.likes_count,
    comments_count: row.comments_count,
    author_name: authorName,
  };
}

/** The media block, rendered server-side so it loads without JavaScript. */
function renderMedia(post: ShareablePost, poster: string | null): string {
  const url = post.attachment_url;
  if (!url) return "";

  if (post.attachment_type === "image") {
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml("Post image")}" ` +
      `style="width:100%;height:auto;border-radius:12px;display:block" loading="eager" />`;
  }

  if (post.attachment_type === "video") {
    // A provider link cannot be played by a <video> element, so it is rendered
    // as a poster linking out. An uploaded file plays inline.
    const isDirectFile = /\.(mp4|m4v|webm|ogv|mov)(\?|#|$)/i.test(url);
    if (!isDirectFile) {
      const label = escapeHtml("Watch the video");
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" ` +
        `style="display:block;text-decoration:none">` +
        (poster
          ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml("Video thumbnail")}" ` +
            `style="width:100%;height:auto;border-radius:12px;display:block" loading="eager" />`
          : "") +
        `<span style="display:inline-block;margin-top:8px;font-weight:600;color:#2563eb">${label}</span>` +
        `</a>`;
    }
    return `<video controls preload="metadata" playsinline ` +
      (poster ? `poster="${escapeHtml(poster)}" ` : "") +
      `style="width:100%;max-width:640px;border-radius:12px;display:block;background:#000">` +
      `<source src="${escapeHtml(url)}" type="${escapeHtml("video/mp4")}" />` +
      `Your browser cannot play this video. ` +
      `<a href="${escapeHtml(url)}">Download it</a>.</video>`;
  }

  if (post.attachment_type === "document") {
    return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">` +
      `Download the attached document</a></p>`;
  }

  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id ?? "").trim();
  const noStore = (status: number, message: string) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).send(
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
        `<meta name="viewport" content="width=device-width,initial-scale=1" />` +
        `<meta name="robots" content="noindex,nofollow" />` +
        `<title>${escapeHtml(message)}</title></head>` +
        `<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">` +
        `<h1 style="font-size:1.5rem">${escapeHtml(message)}</h1>` +
        `<p><a href="${escapeHtml(`${SITE_URL}/community`)}">Browse the Investours Opportunity Hub</a></p>` +
        `</body></html>`,
    );
  };

  if (!id) return noStore(400, "This link is incomplete.");
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[post] Missing Supabase configuration on the server.");
    return noStore(500, "This page is temporarily unavailable.");
  }

  const post = await fetchPost(id).catch((error) => {
    console.error("[post] lookup failed:", error);
    return null;
  });

  // Not visible to the anon key means unapproved, hidden, or gone. All three
  // are the same 404 so nothing about private posts leaks.
  if (!post) return noStore(404, "This post is not available.");

  const canonicalUrl = `${SITE_URL}/post/${encodeURIComponent(post.id)}`;
  const appUrl = `${SITE_URL}/community?post=${encodeURIComponent(post.id)}`;

  // Verified variant: an uploaded video's stored frame is only used if it
  // really exists. A post with no usable media resolves to no image at all, and
  // then no image tag is emitted - see the tag blocks below.
  const preview = await resolvePostPreviewImage(post, post.author_name);
  const meta = buildPostMetadata(post, {
    canonicalUrl,
    // The resolved preview, not a fresh derivation: an uploaded video's stored
    // frame is a candidate until a HEAD confirms it, and using the unresolved
    // value would put a 404 URL in og:image.
    preview,
  });

  const author = (post.author_name ?? "").trim();
  const published = post.created_at ? new Date(post.created_at).toISOString() : null;
  const body = (post.content ?? "").trim();

  // A crawler must not be redirected, or it would follow the redirect to the SPA
  // shell and re-read index.html - which advertises the site logo. That is the
  // reason a correct og:image kept rendering as the logo.
  const forward = !isCrawler(String(req.headers["user-agent"] ?? ""));

  // Declared before the tag blocks that use it. A const arrow function is in the
  // temporal dead zone until its declaration is evaluated, so referencing it
  // above crashes the moment an image actually exists.
  const dims = (w: number | null, h: number | null) =>
    w && h
      ? `\n  <meta property="og:image:width" content="${w}" />\n  <meta property="og:image:height" content="${h}" />`
      : "";

  // Only advertise an image the post actually owns. Emitting the site logo here
  // claimed every text-only post had a picture, which misrepresents it, so a post
  // with no media is shared as text and the image tags are omitted entirely.
  const imageTags = meta.image
    ? `
  <meta property="og:image" content="${escapeHtml(meta.image)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(meta.image)}" />
  <meta property="og:image:alt" content="${escapeHtml(meta.imageAlt)}" />${dims(preview.width, preview.height)}`
    : "";
  const twitterImageTags = meta.image
    ? `
  <meta name="twitter:image" content="${escapeHtml(meta.image)}" />
  <meta name="twitter:image:alt" content="${escapeHtml(meta.imageAlt)}" />`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(meta.title)}</title>
  <meta name="description" content="${escapeHtml(meta.description)}" />
  <link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />

  <meta property="og:site_name" content="Investours" />
  <meta property="og:type" content="${meta.ogType}" />
  <meta property="og:title" content="${escapeHtml(meta.title)}" />
  <meta property="og:description" content="${escapeHtml(meta.description)}" />
  <meta property="og:url" content="${escapeHtml(meta.canonicalUrl)}" />${imageTags}
  <meta property="og:locale" content="en_NG" />${
    published ? `\n  <meta property="article:published_time" content="${escapeHtml(published)}" />` : ""
  }

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@investours" />
  <meta name="twitter:creator" content="@investours" />
  <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
  <meta name="twitter:description" content="${escapeHtml(meta.description)}" />${twitterImageTags}

  <link rel="icon" type="image/png" href="${escapeHtml(`${SITE_URL}/favicon.png`)}" />
  <script type="application/ld+json">${escapeJsonLd(
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SocialMediaPosting",
      headline: meta.title,
      articleBody: body || undefined,
      url: meta.canonicalUrl,
      image: meta.image ? [meta.image] : undefined,
      datePublished: published ?? undefined,
      author: author ? { "@type": "Person", name: author } : undefined,
      interactionStatistic: [
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/LikeAction",
          userInteractionCount: post.likes_count ?? 0,
        },
        {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/CommentAction",
          userInteractionCount: post.comments_count ?? 0,
        },
      ],
    }),
  )}</script>
${forward ? `  <meta http-equiv="refresh" content="0;url=${escapeHtml(appUrl)}" />` : ""}
</head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a">
  <main style="max-width:44rem;margin:0 auto;padding:2rem 1rem 4rem">
    <p style="margin:0 0 1rem"><a href="${escapeHtml(`${SITE_URL}/community`)}" style="color:#2563eb;text-decoration:none;font-weight:600">Investours Opportunity Hub</a></p>
    <article style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:1.5rem">
      ${author ? `<p style="margin:0 0 .5rem;font-weight:600">${escapeHtml(author)}</p>` : ""}
      ${body ? `<div style="white-space:pre-wrap;font-size:1.05rem;line-height:1.6">${escapeHtml(body)}</div>` : ""}
      ${renderMedia(post, preview.image)}
      <p style="margin:1.5rem 0 0;font-size:.875rem;color:#64748b">
        ${post.likes_count ?? 0} likes &middot; ${post.comments_count ?? 0} comments
      </p>
    </article>
    <p style="margin-top:1.5rem">
      <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:.7rem 1.1rem;border-radius:10px;font-weight:600">Open in Investours</a>
    </p>
  </main>
${forward ? `  <script>window.location.replace(${JSON.stringify(appUrl)});</script>\n` : ""}</body>
</html>`;

  // Crawlers must always see current data, and a human who lands here should not
  // be stuck on a stale copy either.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}
