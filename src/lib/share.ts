/**
 * Share copy for the Investours Creativity & Enterprise Challenge posts.
 *
 * Posts filed under the `aiwc` category are competition entries, so sharing
 * one has to carry the pitch with it - otherwise the link goes out with no
 * context and nobody knows what they are being asked to support.
 */

export const AIWC_CATEGORY = "aiwc";

/**
 * Is this an Investours Creativity & Enterprise Challenge category?
 *
 * Tolerant on purpose: `posts.category` stores the admin-defined slug, which
 * may be `aiwc`, `aiwc_competition`, `aiwc-competition` and so on, while the
 * visible label may read "AIWC Competition" or "Idea Competition". Matching
 * only the exact slug meant a share could silently fall back to the generic
 * summary for a post that was plainly a competition entry.
 */
export function isAiwcCategory(value?: string | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return false;
  if (v.includes("aiwc")) return true;
  const compact = v.replace(/[\s_.-]+/g, "");
  if (compact === "ideacompetition" || compact === "competition") return true;
  // Any competition-named category (e.g. "NYSC FCT Competition",
  // "UniAbuja Competition") carries the competition share copy.
  return /\bcompetitions?\b/.test(v);
}

/**
 * The write-up attached to every AIWC share.
 */
export const AIWC_SHARE_TEXT = `🚀 I’m competing in the Investours Creativity & Enterprise Challenge!
🏆 Competing for a share of the ₦1,500,000+ prize pool!
🤖 To vote for me, unlock Investours' AI-powered tools starting at just ₦1,700.
🗳️ You get premium AI access, and your vote instantly validates my entry!
#Investours #AITools`;

/**
 * Condensed pitch for link previews (og:description, Twitter cards), where
 * the full write-up would be truncated mid-sentence anyway.
 */
export const AIWC_OG_DESCRIPTION =
  "I’m competing in the Investours Creativity & Enterprise Challenge! " +
  "Competing for a share of the ₦1,500,000+ prize pool!";

/**
 * The message body for sharing a post. AIWC entries get the full pitch;
 * everything else keeps the usual "check out this post" summary.
 *
 * `categoryLabel` is the admin-facing label, checked alongside the stored
 * slug so a competition entry is recognised whichever form the admin named
 * it with.
 */
export function postShareText(
  post: { category?: string | null; content?: string | null } | undefined | null,
  pageUrl: string,
  categoryLabel?: string,
): string {
  if (isAiwcCategory(post?.category) || isAiwcCategory(categoryLabel)) {
    return `${AIWC_SHARE_TEXT}\n\n${pageUrl}`;
  }

  const content = post?.content ?? "";
  const preview = content.length > 100 ? `${content.substring(0, 100)}...` : content;
  return `Check out this post from Investours Opportunity Hub: "${preview}"\n\n${pageUrl}`;
}

/**
 * Build a share URL that carries the post owner's referral code.
 * If the recipient is not signed up, they'll be redirected to signup
 * with the referral code preserved.
 */
export function buildReferralShareUrl(
  postId: string,
  referralCode: string | null | undefined,
): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://investours.app";
  const refParam = referralCode ? `?ref=${encodeURIComponent(referralCode)}` : "";
  return `${origin}/post/${encodeURIComponent(postId)}${refParam}`;
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
