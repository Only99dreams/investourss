import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Shareable page for a training video: /training/:id
 *
 * The app is a client-rendered SPA, so crawlers fetching /dashboard?module=...
 * only see the site's generic metadata and no thumbnail. This endpoint gives
 * each published training video one canonical URL whose HTML contains the
 * title, description and thumbnail that social networks read. Humans are sent
 * straight to the module in the dashboard.
 *
 * The module is read with the anon key, so the existing RLS policy on
 * education_modules ("Anyone can view published modules") decides visibility.
 * Unpublished or missing modules get the same 404 and never expose their data.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";
const VERCEL_URL = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
const SITE_URL = (process.env.SITE_URL || VERCEL_URL || "https://investours.app").replace(/\/$/, "");

const CRAWLER_UA =
  /facebookexternalhit|facebookcatalog|facebot|whatsapp|twitterbot|linkedinbot|slackbot|slack-imgproxy|discordbot|telegrambot|skypeuripreview|applebot|redditbot|embedly|pinterest|quora|vkshare|bot\b|crawler|spider|preview/i;

// Redirect only recognizable human browsers. Anything else (link-preview
// scrapers, QA tools, unknown bots) gets the metadata page, so a crawler we
// do not recognise cannot accidentally be sent to the JS-only dashboard.
const BROWSER_UA = /mozilla\/5\.0.*(applewebkit|chrome|firefox|safari|edg|opr)/i;

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface TrainingModule {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
}

/** Derive the same thumbnails the dashboard uses for YouTube videos. */
function resolveThumbnail(module: TrainingModule): string | null {
  if (module.thumbnail_url?.trim()) return module.thumbnail_url.trim();

  const url = module.video_url ?? "";
  const patterns = [
    /[?&]v=([^&#]+)/, // youtube.com/watch?v=
    /youtu\.be\/([^?#]+)/, // youtu.be/<id>
    /youtube\.com\/(?:embed|shorts|live)\/([^?#]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    const videoId = match?.[1];
    if (videoId && /^[A-Za-z0-9_-]+$/.test(videoId)) {
      return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }
  }
  return null;
}

function isDirectVideoFile(url: string): boolean {
  return /\.(mp4|m4v|webm|ogv|mov)(\?|#|$)/i.test(url);
}

async function fetchModule(id: string): Promise<TrainingModule | null> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/education_modules?id=eq.${encodeURIComponent(id)}` +
      `&select=id,title,description,video_url,thumbnail_url&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as TrainingModule[];
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id ?? "").trim();
  const ref = String(req.query.ref ?? "").trim();

  const unavailable = (status: number, message: string) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).send(
      `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
        `<meta name="viewport" content="width=device-width,initial-scale=1" />` +
        `<meta name="robots" content="noindex,nofollow" />` +
        `<title>${escapeHtml(message)}</title></head>` +
        `<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem">` +
        `<h1 style="font-size:1.5rem">${escapeHtml(message)}</h1>` +
        `<p><a href="${escapeHtml(`${SITE_URL}/`)}">Visit Investours</a></p>` +
        `</body></html>`,
    );
  };

  if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return unavailable(400, "This link is incomplete.");
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[training] Missing Supabase configuration on the server.");
    return unavailable(500, "This page is temporarily unavailable.");
  }

  const module = await fetchModule(id).catch((error) => {
    console.error("[training] lookup failed:", error);
    return null;
  });
  if (!module) return unavailable(404, "This training video is not available.");

  const canonicalUrl = `${SITE_URL}/training/${encodeURIComponent(module.id)}`;
  // The dashboard's nested route is /dashboard/education. The ?tab=education
  // form is redirected by the SPA index route and drops the module/ref params.
  const appUrl =
    `${SITE_URL}/dashboard/education?module=${encodeURIComponent(module.id)}` +
    (ref ? `&ref=${encodeURIComponent(ref)}` : "");

  // Humans continue straight into the video; everything else gets the HTML
  // preview. Bot user agents are never redirected, even if they look like a
  // browser (Applebot, for example).
  const userAgent = String(req.headers["user-agent"] ?? "");
  const acceptsHtml = /text\/html/.test(String(req.headers.accept ?? ""));
  const isHumanBrowser =
    BROWSER_UA.test(userAgent) && acceptsHtml && !CRAWLER_UA.test(userAgent);
  if (isHumanBrowser) {
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, appUrl);
  }

  const title = `${module.title} | Investours Training`;
  const description =
    module.description?.trim() || `Watch ${module.title} on Investours.`;
  // Always emit an image. Modules with no thumbnail (for example a Google
  // Drive video) still get a real preview card instead of a bare link.
  const thumbnail = resolveThumbnail(module) ?? `${SITE_URL}/logo.png`;
  const videoUrl = module.video_url?.trim();
  const videoTags =
    videoUrl && thumbnail && isDirectVideoFile(videoUrl)
      ? `
  <meta property="og:video" content="${escapeHtml(videoUrl)}" />
  <meta property="og:video:secure_url" content="${escapeHtml(videoUrl)}" />
  <meta property="og:video:type" content="video/mp4" />`
      : "";
  const imageTags = thumbnail
    ? `
  <meta property="og:image" content="${escapeHtml(thumbnail)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(thumbnail)}" />
  <meta property="og:image:alt" content="${escapeHtml(module.title)}" />
  <meta name="twitter:image" content="${escapeHtml(thumbnail)}" />`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />

  <meta property="og:site_name" content="Investours" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />${imageTags}${videoTags}

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@investours" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <link rel="icon" type="image/png" href="${escapeHtml(`${SITE_URL}/favicon.png`)}" />
</head>
<body style="margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f8fafc;color:#0f172a">
  <main style="max-width:44rem;margin:0 auto;padding:2rem 1rem 4rem">
    <p style="margin:0 0 1rem"><a href="${escapeHtml(`${SITE_URL}/`)}" style="color:#2563eb;text-decoration:none;font-weight:600">Investours Training</a></p>
    <article style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:1.5rem">
      ${
        thumbnail
          ? `<img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(module.title)}" style="width:100%;height:auto;border-radius:12px;display:block" loading="eager" />`
          : ""
      }
      <h1 style="font-size:1.4rem;margin:1rem 0 .5rem">${escapeHtml(module.title)}</h1>
      <p style="white-space:pre-wrap;font-size:1rem;line-height:1.6;color:#475569">${escapeHtml(description)}</p>
    </article>
    <p style="margin-top:1.5rem">
      <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:.7rem 1.1rem;border-radius:10px;font-weight:600">Watch in Investours</a>
    </p>
  </main>
</body>
</html>`;

  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=86400");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(html);
}
