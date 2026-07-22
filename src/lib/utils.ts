import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateVideoThumbnail(videoSrc: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = videoSrc;

    const timeout = setTimeout(() => {
      video.src = "";
      resolve(null);
    }, 10000);

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration * 0.25);
    };
    video.onseeked = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      } finally {
        video.src = "";
      }
    };
    video.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
  });
}

export function updateShareOGTags(opts: {
  title: string;
  description: string;
  image?: string | null;
  url: string;
}) {
  const setMeta = (property: string, content: string) => {
    let el = document.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("property", property);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  };
  const setName = (name: string, content: string) => {
    let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  };

  setMeta("og:title", opts.title);
  setMeta("og:description", opts.description);
  setMeta("og:url", opts.url);
  setMeta("og:type", "article");
  if (opts.image) setMeta("og:image", opts.image);

  setName("twitter:card", opts.image ? "summary_large_image" : "summary");
  setName("twitter:title", opts.title);
  setName("twitter:description", opts.description);
  if (opts.image) setName("twitter:image", opts.image);
}
