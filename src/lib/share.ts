/**
 * Share copy for the Investours Idea Competition posts.
 *
 * Posts filed under the `aiwc` category are competition entries, so sharing
 * one has to carry the pitch with it - otherwise the link goes out with no
 * context and nobody knows what they are being asked to support.
 */

export const AIWC_CATEGORY = "aiwc";

export const isAiwcCategory = (category?: string | null): boolean =>
  (category ?? "").trim().toLowerCase() === AIWC_CATEGORY;

/**
 * The write-up attached to every AIWC share. Kept verbatim, including the
 * `*emphasis*` markers: WhatsApp renders those as bold, and the copy was
 * supplied that way.
 */
export const AIWC_SHARE_TEXT = `🚀 I’m competing in the Investours Idea Competition!

I’m pitching my idea for a chance to advance through the competition and compete at the AI Wealth Conference (AIWC) for the *₦1,000,000 Business Uplift Grant!** 🏆

❤️ Comment & love my idea to show your support.

🗳️ Voting is available to eligible Premium subscribers, with voting power determined by their subscription plan.

✨ Investours Premium access starts from just ₦1,700, giving you access to AI-powered financial and entrepreneurship solutions, with voting included as a Premium platform benefit.

🩺 AI Financial Auditor — Your Money Doctor

🎓 AI Financial Tutor

📋 AI Business Planner

🛡️ Investment Scam Detector

Please support my idea, share it with others, and help me advance to the next stage!

🙏 Thank you for your support!`;

/**
 * Condensed pitch for link previews (og:description, Twitter cards), where
 * the full write-up would be truncated mid-sentence anyway.
 *
 * Mirrored in api/share.ts - that function is bundled separately by Vercel
 * and cannot import from src/, so the string is kept in step by hand.
 */
export const AIWC_OG_DESCRIPTION =
  "I’m competing in the Investours Idea Competition! Voting is open to eligible " +
  "Premium subscribers, with voting power determined by their plan. Premium " +
  "starts from ₦1,700.";

/**
 * The message body for sharing a post. AIWC entries get the full pitch;
 * everything else keeps the usual "check out this post" summary.
 */
export function postShareText(
  post: { category?: string | null; content?: string | null } | undefined | null,
  pageUrl: string,
): string {
  if (isAiwcCategory(post?.category)) {
    return `${AIWC_SHARE_TEXT}\n\n${pageUrl}`;
  }

  const content = post?.content ?? "";
  const preview = content.length > 100 ? `${content.substring(0, 100)}...` : content;
  return `Check out this post from Investours Opportunity Hub: "${preview}"\n\n${pageUrl}`;
}

/** Link-preview description for a post. */
export function postOgDescription(
  post: { category?: string | null; content?: string | null } | undefined | null,
  likesCount: number,
  commentsCount: number,
): string {
  if (isAiwcCategory(post?.category)) {
    return AIWC_OG_DESCRIPTION;
  }

  const contentPreview = (post?.content ?? "").substring(0, 200);
  return contentPreview
    ? `${contentPreview}${contentPreview.length >= 200 ? "..." : ""} — ${likesCount} likes, ${commentsCount} comments`
    : "Check out this opportunity on Investours";
}
