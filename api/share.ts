import type { VercelRequest, VercelResponse } from "@vercel/node";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://xpghrhuxmfaljtptvriy.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZ2hyaHV4bWZhbGp0cHR2cml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE4MjcsImV4cCI6MjA4MTgwNzgyN30.aNfG9tEKRcgNR36HvN1wX3sux4R6Z6_wTApBBMMboEc";
const SITE_URL = "https://investours.com";
const DEFAULT_IMAGE = `${SITE_URL}/logo.png`;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const postId = req.query.post as string;
  const ref = (req.query.ref as string) || "";

  if (!postId) {
    return res.redirect(302, "/community");
  }

  const redirectUrl = `${SITE_URL}/community?post=${postId}${ref ? `&ref=${ref}` : ""}`;

  try {
    const postRes = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=content,attachment_url,attachment_type,author_id`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const posts = await postRes.json();
    const post = posts?.[0];

    if (!post) {
      return res.redirect(302, "/community");
    }

    let authorName = "Investours Member";
    try {
      const profileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${post.author_id}&select=full_name`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const profiles = await profileRes.json();
      if (profiles?.[0]?.full_name) {
        authorName = profiles[0].full_name;
      }
    } catch {
      // use default
    }

    const contentPreview = (post.content || "").substring(0, 200);
    const ogTitle = `${authorName} shared a post on Investours Opportunity Hub`;
    const ogDescription = contentPreview || "Check out this opportunity on Investours";
    const ogImage =
      post.attachment_type === "image" && post.attachment_url
        ? post.attachment_url
        : DEFAULT_IMAGE;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(ogTitle)}</title>

  <meta property="og:title" content="${escapeHtml(ogTitle)}" />
  <meta property="og:description" content="${escapeHtml(ogDescription)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:url" content="${escapeHtml(redirectUrl)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Investours" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@investours" />
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

  <meta http-equiv="refresh" content="0;url=${escapeHtml(redirectUrl)}" />
  <script>window.location.href="${escapeHtml(redirectUrl)}";</script>
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(redirectUrl)}">Investours Opportunity Hub</a>...</p>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    return res.status(200).send(html);
  } catch {
    return res.redirect(302, "/community");
  }
}
