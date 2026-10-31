/**
 * First-page previews for uploaded PDFs.
 *
 * The Ebook Track lets competition entrants attach the PDF version of their
 * book. A PDF cannot advertise a poster the way a video can, so the browser
 * renders page one to a JPEG and stores it beside the PDF as `-thumb.jpg`. The
 * feed and the share endpoint can then find the preview from the PDF URL alone,
 * exactly like an uploaded video's poster frame.
 *
 * PDF.js is loaded lazily: text-only posts, images and videos never pay for it,
 * and the library lands in its own chunk.
 */

import { supabase } from "@/integrations/supabase/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  dataUrlToBlob,
  isPdfUrl,
  siblingThumbnailUrl,
} from "@/lib/video";
import {
  pathFromPublicUrl,
  publicUrlForPath,
  THUMB_BUCKET,
} from "@/lib/videoThumbnail";

/** Rendered previews are kept small - they are cards, not readable pages. */
const PREVIEW_WIDTH = 640;
const JPEG_QUALITY = 0.82;

type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** Load PDF.js and point it at the worker Vite bundled. */
async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/**
 * Render page one of a PDF to a JPEG data URL.
 *
 * Accepts a local File (used right after the member picks it) or a URL (used
 * for linked PDFs and for backfilling older uploads). Cross-origin links can be
 * refused by the host's CORS policy; that is not an error the member should see,
 * it just means the post falls back to a PDF card with no page image.
 */
export async function generatePdfThumbnail(
  source: File | string,
): Promise<string | null> {
  if (typeof document === "undefined") return null;

  let doc: PDFDocumentProxy | null = null;
  try {
    const pdfjs = await loadPdfjs();
    const loadingTask =
      typeof source === "string"
        ? pdfjs.getDocument({ url: source })
        : pdfjs.getDocument({ data: new Uint8Array(await source.arrayBuffer()) });

    doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.max(0.4, PREVIEW_WIDTH / baseViewport.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    if (!context) return null;

    // PDF pages may have transparent backgrounds; JPEG would render those black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch (error) {
    console.warn("PDF thumbnail skipped:", error);
    return null;
  } finally {
    if (doc) {
      try {
        await doc.destroy();
      } catch {
        /* the preview already exists or never will - teardown is best effort */
      }
    }
  }
}

/**
 * A stored preview for a PDF, or null when there is none yet.
 *
 * The PDF.js render is deliberately not used for a random viewer here. It is
 * expensive, so the feed only confirms the stored sibling is present and lets
 * the author backfill older entries.
 */
export async function storedPdfThumbnailFor(pdfPublicUrl: string): Promise<string | null> {
  if (!isPdfUrl(pdfPublicUrl)) return null;
  const candidate = siblingThumbnailUrl(pdfPublicUrl);
  if (!candidate) return null;
  try {
    const res = await fetch(candidate, { method: "HEAD" });
    return res.ok ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Capture page one from a just-picked PDF and store it beside the PDF.
 * Called before the post is inserted, so every new entry has a preview.
 */
export async function attachPdfThumbnailToUpload(
  file: File,
  pdfPath: string,
): Promise<string | null> {
  try {
    const dataUrl = await generatePdfThumbnail(file);
    if (!dataUrl) return null;

    const blob = await dataUrlToBlob(dataUrl);
    if (!blob || blob.size === 0) return null;

    const thumbPath = pdfPath.replace(/\.pdf$/i, "-thumb.jpg");
    const { error } = await supabase.storage
      .from(THUMB_BUCKET)
      .upload(thumbPath, blob, {
        cacheControl: "3600",
        upsert: true,
        contentType: "image/jpeg",
      });

    if (error) {
      console.warn("PDF thumbnail upload failed:", error.message);
      return null;
    }
    return publicUrlForPath(thumbPath);
  } catch (error) {
    console.warn("PDF thumbnail capture skipped:", error);
    return null;
  }
}

/**
 * Generate and store the missing preview for an already-uploaded PDF.
 *
 * Only the post author may call this: writing to storage is privileged, and a
 * viewer must not be able to create files in another member's folder.
 */
export async function backfillPdfThumbnail(pdfPublicUrl: string): Promise<string | null> {
  if (!isPdfUrl(pdfPublicUrl)) return null;
  if (await storedPdfThumbnailFor(pdfPublicUrl)) return null;

  const target = siblingThumbnailUrl(pdfPublicUrl);
  const path = target ? pathFromPublicUrl(target) : null;
  if (!target || !path) return null;

  try {
    const dataUrl = await generatePdfThumbnail(pdfPublicUrl);
    if (!dataUrl) return null;

    const blob = await dataUrlToBlob(dataUrl);
    if (!blob || blob.size === 0) return null;

    const { error } = await supabase.storage
      .from(THUMB_BUCKET)
      .upload(path, blob, {
        cacheControl: "3600",
        upsert: true,
        contentType: "image/jpeg",
      });

    if (error) {
      console.warn("PDF thumbnail backfill failed:", error.message);
      return null;
    }
    return publicUrlForPath(path) ?? target;
  } catch (error) {
    console.warn("PDF thumbnail backfill skipped:", error);
    return null;
  }
}
