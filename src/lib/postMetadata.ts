/**
 * The single source of truth for how a post is presented when it is shared.
 *
 * Every surface that needs a post's title, description, canonical URL or preview
 * image goes through here: the /post/:id server-rendered page, the /api/share
 * redirect, and the client-side tag updates when someone opens a post in the
 * app. Logic that exists twice is logic that will disagree, and the earlier
 * duplication between src/lib/share.ts and api/share.ts had already drifted.
 *
 * Everything is pure and side-effect free. The one exception is
 * `resolvePostPreviewImage`, which may perform a network HEAD to confirm a
 * video's stored frame exists; the client should prefer the synchronous
 * `derivePostPreview` and the server may use the resolving variant.
 *
 * This module is imported by files in `api/`. Vercel compiles each function with
 * esbuild before tracing it, so those imports are bundled in and the function
 * stays self-contained - verified with @vercel/nft against a real esbuild output,
 * not assumed.
 */

import { parseVideoLink, siblingThumbnailUrl, attachmentThumbnail } from "@/lib/video";
import { isAiwcCategory, AIWC_OG_DESCRIPTION } from "@/lib/share";

/** The subset of a post that sharing needs. */
export interface ShareablePost {
  id: string;
  content?: string | null;
  category?: string | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  author_name?: string | null;
  created_at?: string | null;
  likes_count?: number | null;
  comments_count?: number | null;
}

export type PreviewKind = "image" | "video-poster" | "none";

export interface PostPreview {
  /**
   * Absolute HTTPS URL for the post's own media, or null when it has none.
   *
   * Null is deliberate. Falling back to the site logo meant every text-only post
   * was shared with a picture that is not part of the post, which misrepresents
   * it - a logo implies an image that does not exist. Platforms render a clean
   * title-and-description preview with no og:image at all, which is the honest
   * representation of a post with no media.
   */
  image: string | null;
  kind: PreviewKind;
  /** True when `image` is a candidate that still needs confirming with a HEAD. */
  needsVerification: boolean;
  width: number | null;
  height: number | null;
  alt: string;
}

export interface PostMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  image: string;
  imageAlt: string;
  imageWidth: number | null;
  imageHeight: number | null;
  ogType: "article";
  /** Set only when the post's own media is a playable video. */
  videoUrl: string | null;
  videoMimeType: string | null;
  /**
   * True when nothing on the post resolved, so no image should be advertised.
   */
  usesDefaultImage: boolean;
  isCompetitionEntry: boolean;
}

/** YouTube's hqdefault poster, which is the only variant guaranteed to exist. */
const YOUTUBE_POSTER = { width: 480, height: 360 };

/**
 * A captured video frame inherits the video's own dimensions, which are not
 * knowable from the URL. Asserting a plausible 1280x720 is a guess, and a wrong
 * og:image:width/height is worse than none because platforms size the card from
 * it and crop unpredictably - so the frame's dimensions are deliberately omitted.
 */
const CAPTURED_FRAME = { width: null as number | null, height: null as number | null };

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
};

export function videoMimeTypeFor(url: string | null | undefined): string | null {
  if (!url) return null;
  const ext = url.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_MIME[ext] ?? null;
}

/** Collapse the many ways a post body can be empty or whitespace into "". */
function bodyOf(post: ShareablePost | null | undefined): string {
  return (post?.content ?? "").replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

/**
 * Decide which image represents this post.
 *
 * Order matters and is the whole point of this function:
 *   1. an uploaded image is the post itself
 *   2. a video *link* yields the provider's poster (YouTube, Vimeo)
 *   3. an uploaded video yields the frame stored beside it, flagged for
 *      verification - older posts predate frame capture, and emitting a URL that
 *      404s produces a broken preview
 *   4. otherwise nothing, and no og:image is advertised at all
 *
 * On (4): a post with no media is shared as text. That is what the post is, and
 * a preview showing the site logo would claim it has a picture when it does not.
 *
 * The schema has a single `attachment_url`, so a post has at most one piece of
 * media. Multiple images per post are not currently representable; when that is
 * added this is the one place that needs to change.
 */
export function derivePostPreview(
  post: ShareablePost | null | undefined,
  authorName?: string | null,
): PostPreview {
  const url = post?.attachment_url ?? null;
  const type = post?.attachment_type ?? null;
  const alt = authorName
    ? `Media shared by ${authorName} on Investours`
    : "Media shared on Investours";

  if (url && type === "image") {
    return {
      image: url,
      kind: "image",
      needsVerification: false,
      // A member's upload can be any size, and the server cannot read the file
      // cheaply, so no dimensions are asserted rather than a guess.
      width: null,
      height: null,
      alt,
    };
  }

  if (url && type === "video") {
    const link = parseVideoLink(url);
    if (link?.thumbnailUrl) {
      return {
        image: link.thumbnailUrl,
        kind: "video-poster",
        needsVerification: false,
        width: YOUTUBE_POSTER.width,
        height: YOUTUBE_POSTER.height,
        alt,
      };
    }

    // An uploaded file. siblingThumbnailUrl returns null unless the URL really
    // is a stored video, so a link that merely looks like a file is skipped.
    const candidate = siblingThumbnailUrl(url);
    if (candidate) {
      return {
        image: candidate,
        kind: "video-poster",
        needsVerification: true,
        width: CAPTURED_FRAME.width,
        height: CAPTURED_FRAME.height,
        alt,
      };
    }
  }

  return {
    image: null,
    kind: "none",
    needsVerification: false,
    width: null,
    height: null,
    alt,
  };
}

/** Confirm a remote object exists, bounded so a slow host cannot hang a share. */
async function objectExists(url: string, timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Confirms short-lived, because a video's frame is written once and never
 * changes. A warm function instance reuses the answer instead of issuing a HEAD
 * on every share of the same post.
 */
const framePresence = new Map<string, { at: number; exists: boolean }>();
const FRAME_CACHE_MS = 10 * 60 * 1000;

/**
 * The preview image, with any stored video frame verified to exist.
 *
 * A frame that has not been generated yet yields no image at all rather than a
 * URL that would render broken, and rather than a logo that is not the post's.
 */
export async function resolvePostPreviewImage(
  post: ShareablePost | null | undefined,
  authorName?: string | null,
): Promise<PostPreview> {
  const preview = derivePostPreview(post, authorName);
  if (!preview.needsVerification || !preview.image) return preview;

  const cached = framePresence.get(preview.image);
  if (cached && Date.now() - cached.at < FRAME_CACHE_MS) {
    return cached.exists ? preview : derivePostPreview(null, authorName);
  }

  const exists = await objectExists(preview.image);
  framePresence.set(preview.image, { at: Date.now(), exists });
  return exists ? preview : derivePostPreview(null, authorName);
}

/**
 * Everything needed to render a post's sharing metadata.
 *
 * `canonicalUrl` is passed in rather than derived here, because the canonical URL
 * is a property of the site configuration and the route, not of the post. The
 * one canonical URL per post is the caller's job to get right.
 */
export function buildPostMetadata(
  post: ShareablePost,
  options: {
    canonicalUrl: string;
    siteName?: string;
    /** Replaces the generated description, for entries that need specific copy. */
    descriptionOverride?: string | null;
    /**
     * A preview already resolved with `resolvePostPreviewImage`. Supplied by the
     * server, which has confirmed an uploaded video's stored frame exists;
     * without it the unverified candidate is used and could 404.
     */
    preview?: PostPreview;
  },
): PostMetadata {
  const siteName = options.siteName ?? "Investours Opportunity Hub";
  const body = bodyOf(post);
  const isEntry = isAiwcCategory(post.category);
  const author = (post.author_name ?? "").trim();
  const likes = post.likes_count ?? 0;
  const comments = post.comments_count ?? 0;

  // A competition entry leads with the pitch, exactly as the in-app share text
  // does, so the link and the message agree.
  const description =
    options.descriptionOverride ??
    (isEntry
      ? AIWC_OG_DESCRIPTION
      : body
        ? `${truncate(body, 200)}${likes || comments ? ` - ${likes} likes, ${comments} comments` : ""}`
        : "A post from the Investours Opportunity Hub.");

  // There is no separate post title, so the body leads and the site names the
  // source. The excerpt is kept short because it is also the browser tab text.
  const headline = body ? truncate(body, 70) : "A post on Investours";
  const title = author ? `${headline} - ${author} on ${siteName}` : `${headline} - ${siteName}`;

  const preview = options.preview ?? derivePostPreview(post, author);

  return {
    title,
    description,
    canonicalUrl: options.canonicalUrl,
    image: preview.image,
    imageAlt: preview.alt,
    // Dimensions are only asserted where they are known. A stored video frame is
    // a candidate at this point, so it carries no size until it is resolved.
    imageWidth: preview.needsVerification ? null : preview.width,
    imageHeight: preview.needsVerification ? null : preview.height,
    ogType: "article",
    videoUrl:
      post.attachment_type === "video" ? (post.attachment_url ?? null) : null,
    videoMimeType:
      post.attachment_type === "video" ? videoMimeTypeFor(post.attachment_url) : null,
    // True when the post has no media, so no image is advertised at all.
    usesDefaultImage: preview.kind === "none",
    isCompetitionEntry: isEntry,
  };
}

export { attachmentThumbnail };
