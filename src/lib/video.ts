/**
 * Video link support for community posts.
 *
 * Alongside an uploaded video file, a creator can paste a link to a hosted
 * video (YouTube, Vimeo, or a direct .mp4/.webm file). For those we can derive
 * a poster frame from the URL alone, which matters because link previews
 * (og:image) are fetched by the server - the browser-generated thumbnails used
 * elsewhere are data URLs that never leave the client.
 */

export type VideoProvider = "youtube" | "vimeo" | "file";

export interface VideoLink {
  provider: VideoProvider;
  /** Raw watch URL, as the creator pasted it. */
  url: string;
  /** Embeddable player URL, or the URL itself for direct files. */
  embedUrl: string;
  /** Absolute poster image, or null when none can be derived. */
  thumbnailUrl: string | null;
}

const YOUTUBE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
];

const VIMEO_HOSTS = ["vimeo.com", "www.vimeo.com", "player.vimeo.com"];

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

/** True for a bare URL a creator pasted. */
export function isHttpUrl(value: string): boolean {
  const v = value.trim();
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    const parsed = new URL(v);
    return Boolean(parsed.hostname) && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

function youtubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host === "youtu.be" || host === "www.youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return v;
      // /shorts/<id>, /embed/<id>, /live/<id>
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live", "v"].includes(segments[0]) && segments[1]) {
        return segments[1];
      }
    }
    return null;
  } catch {
    return null;
  }
}

function vimeoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    // /123456789, /video/123456789, /channels/x/123456789
    const numeric = segments.filter((s) => /^\d+$/.test(s)).pop();
    return numeric || null;
  } catch {
    return null;
  }
}

const DIRECT_VIDEO_EXT = /\.(mp4|m4v|webm|ogv|mov)(\?.*)?$/i;

/** Same as above but path-only, so it can rewrite a storage path in place. */
const VIDEO_PATH_EXT = /\.(mp4|m4v|webm|ogv|mov)$/i;
const PDF_PATH_EXT = /\.pdf$/i;

/** True when the attachment URL points at a PDF file. */
export function isPdfUrl(attachmentUrl?: string | null): boolean {
  if (!attachmentUrl) return false;
  try {
    return PDF_PATH_EXT.test(new URL(attachmentUrl).pathname);
  } catch {
    return PDF_PATH_EXT.test(attachmentUrl.split("?")[0].split("#")[0]);
  }
}

/**
 * Where the stored preview image for an uploaded video or PDF lives.
 *
 * An uploaded file has no poster derivable from its URL the way a YouTube id
 * is, and the frame the browser generates is a data: URL that is never stored.
 * So the preview is written next to the source under a name both ends can
 * compute independently: `123.mp4` / `123.pdf` -> `123-thumb.jpg`. Deriving it
 * beats storing it in a column, because the server can then find the preview
 * for every existing post without a migration or a backfill job.
 */
export function attachmentThumbPath(pathOrUrl: string): string {
  return pathOrUrl
    .replace(VIDEO_PATH_EXT, "-thumb.jpg")
    .replace(PDF_PATH_EXT, "-thumb.jpg");
}

/** Backwards-compatible name for the video-only callers. */
export function videoThumbPath(videoPathOrUrl: string): string {
  return attachmentThumbPath(videoPathOrUrl);
}

/**
 * Public URL of the stored preview for an uploaded video or PDF, or null when
 * the attachment is not a stored file we can preview.
 *
 * Returning a candidate is not proof the file exists: older posts predate this
 * and have no preview. Callers that need certainty (the share endpoint) must
 * confirm it before using it, and fall back rather than emit a broken image.
 */
export function siblingThumbnailUrl(attachmentUrl?: string | null): string | null {
  if (!attachmentUrl) return null;
  try {
    const parsed = new URL(attachmentUrl);
    if (!VIDEO_PATH_EXT.test(parsed.pathname) && !PDF_PATH_EXT.test(parsed.pathname)) return null;
    parsed.pathname = attachmentThumbPath(parsed.pathname);
    return parsed.toString();
  } catch {
    return null;
  }
}

/** data: URL -> Blob, for uploading a captured frame. */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  try {
    const response = await fetch(dataUrl);
    return await response.blob();
  } catch {
    return null;
  }
}

/**
 * Describe a pasted video URL, or return null when it is not one. Direct video
 * files have no derivable poster frame, so `thumbnailUrl` is null for them.
 */
export function parseVideoLink(rawUrl: string): VideoLink | null {
  const url = rawUrl.trim();
  if (!isHttpUrl(url)) return null;
  const host = hostOf(url);

  if (YOUTUBE_HOSTS.includes(host)) {
    const id = youtubeId(url);
    if (!id) return null;
    return {
      provider: "youtube",
      url,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
      // maxres is not present for every video, so fall back to hq.
      thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }

  if (VIMEO_HOSTS.includes(host)) {
    const id = vimeoId(url);
    if (!id) return null;
    return {
      provider: "vimeo",
      url,
      embedUrl: `https://player.vimeo.com/video/${id}`,
      thumbnailUrl: `https://thumbnail.com/${id}.jpg`,
    };
  }

  if (DIRECT_VIDEO_EXT.test(url)) {
    return { provider: "file", url, embedUrl: url, thumbnailUrl: null };
  }

  return null;
}

/**
 * Poster frame for any stored attachment, so a video post still has something
 * to show in a card and something for a link preview to scrape.
 */
export function attachmentThumbnail(
  attachmentUrl?: string | null,
  attachmentType?: string | null,
): string | null {
  if (!attachmentUrl) return null;
  if (attachmentType === "image") return attachmentUrl;
  if (attachmentType === "video") return parseVideoLink(attachmentUrl)?.thumbnailUrl ?? null;
  if (attachmentType === "pdf" || (attachmentType === "document" && isPdfUrl(attachmentUrl))) {
    // The stored first page, beside the PDF - same convention as video frames.
    return siblingThumbnailUrl(attachmentUrl);
  }
  return null;
}
