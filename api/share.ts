import type { VercelRequest, VercelResponse } from "@vercel/node";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://xpghrhuxmfaljtptvriy.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhwZ2hyaHV4bWZhbGp0cHR2cml5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE4MjcsImV4cCI6MjA4MTgwNzgyN30.aNfG9tEKRcgNR36HvN1wX3sux4R6Z6_wTApBBMMboEc";
const SITE_URL = "https://investours.app";
const DEFAULT_IMAGE = `${SITE_URL}/logo.png`;

function escapeHtml(str: string): string {
  return String(str || "")
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
    return res.redirect(302, `${SITE_URL}/community`);
  }

  const communityUrl = `${SITE_URL}/community?post=${postId}${ref ? `&ref=${ref}` : ""}`;

  try {
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    };

    const postRes = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=content,attachment_url,attachment_type,author_id,likes_count,comments_count`,
      { headers }
    );

    const posts = await postRes.json();
    const post = posts?.[0];

    if (!post) {
      return res.redirect(302, `${SITE_URL}/community`);
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
    const ogDescription = contentPreview
      ? `${contentPreview}${contentPreview.length >= 200 ? "..." : ""} — ${likesCount} likes, ${commentsCount} comments`
      : "Check out this opportunity on Investours";
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
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${escapeHtml(communityUrl)}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Investours" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@investours" />
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

  <link rel="canonical" href="${escapeHtml(communityUrl)}" />
  <meta http-equiv="refresh" content="0;url=${escapeHtml(communityUrl)}" />
  <script>window.location.replace("${escapeHtml(communityUrl)}");</script>
</head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,sans-serif;background:#f9fafb;">
  <div style="text-align:center;padding:2rem;">
    <h2 style="margin-bottom:1rem;">Investours Opportunity Hub</h2>
    <p style="color:#6b7280;margin-bottom:1.5rem;">Taking you to the post...</p>
    <a href="${escapeHtml(communityUrl)}" style="color:#2563eb;text-decoration:underline;">Click here if not redirected</a>
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
    return res.status(200).send(html);
  } catch (error) {
    console.error("Share handler error:", error);
    return res.redirect(302, `${SITE_URL}/community`);
  }
}
