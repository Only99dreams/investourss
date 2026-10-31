import { supabase } from "@/integrations/supabase/client";
import {
  type AudiobookState,
  type BookCover,
  type BookmakerBook,
  type BookmakerEntitlement,
  DEFAULT_ENTITLEMENT,
  makeIdempotencyKey,
} from "./bookmaker";

const COVER_BUCKET = "bookmaker-covers";
const AUDIO_BUCKET = "bookmaker-audio";
// Media buckets are private; links are re-signed well inside a normal session.
const MEDIA_URL_TTL = 60 * 60 * 6;

function storagePathFromUrl(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null;
  const clean = url.split("?")[0];
  for (const marker of [`/object/public/${bucket}/`, `/object/sign/${bucket}/`]) {
    const index = clean.indexOf(marker);
    if (index >= 0) return decodeURIComponent(clean.slice(index + marker.length));
  }
  return null;
}

/** Signs the uploaded cover of a book for the current owner. */
export async function resolveBookCoverUrl(cover: BookCover | null | undefined): Promise<string | null> {
  if (!cover || cover.kind !== "uploaded") return null;
  const path = cover.path || storagePathFromUrl(cover.url, COVER_BUCKET);
  if (path) {
    const { data } = await supabase.storage.from(COVER_BUCKET).createSignedUrl(path, MEDIA_URL_TTL);
    if (data?.signedUrl) return data.signedUrl;
  }
  return cover.url ?? null;
}

/** Signs every narration file of a book, keyed by its storage path. */
export async function resolveAudiobookUrls(
  audiobook: AudiobookState | null | undefined,
): Promise<Record<string, string>> {
  const paths = [
    ...(audiobook?.chapters ?? []).map((chapter) => chapter.path),
    audiobook?.full?.path,
  ].filter((path): path is string => Boolean(path));
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {};

  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUrls(unique, MEDIA_URL_TTL);
  if (error || !data) return {};

  const urls: Record<string, string> = {};
  data.forEach((item, index) => {
    const path = item?.path ?? unique[index];
    if (path && item?.signedUrl) urls[path] = item.signedUrl;
  });
  return urls;
}

export type BookmakerAction =
  | "outline"
  | "start_manuscript"
  | "resume"
  | "chapter"
  | "complete"
  | "abandon"
  | "regenerate_chapter"
  | "regenerate_visual"
  | "generate_cover"
  | "start_audiobook"
  | "audiobook_chapter"
  | "complete_audiobook"
  | "assemble_audiobook"
  | "preview_voice";

export interface BookmakerResponse {
  success: boolean;
  [key: string]: unknown;
}

/**
 * Calls the Bookmaker edge function. Business responses (including
 * insufficient credits and duplicate requests) come back as data so the UI can
 * explain exactly what happened without treating them as crashes.
 */
export async function invokeBookmaker(body: Record<string, unknown>): Promise<BookmakerResponse> {
  const { data, error } = await supabase.functions.invoke("bookmaker", { body });

  if (error) {
    const response = (error as { context?: Response }).context;
    if (response) {
      try {
        // Read as text first: platform-level failures (timeouts, worker limits)
        // return an empty or plain-text body that would otherwise hide the cause.
        const raw = await response.clone().text();
        if (raw) {
          try {
            const payload = JSON.parse(raw);
            if (payload && typeof payload === "object") return payload as BookmakerResponse;
          } catch {
            return { success: false, message: raw.slice(0, 400) } as BookmakerResponse;
          }
        }
      } catch {
        // fall through to the generic message
      }
    }
    throw new Error(error.message || "Bookmaker could not complete that request.");
  }

  return (data ?? { success: false, message: "No response from Bookmaker." }) as BookmakerResponse;
}

export async function previewNarratorVoice(voice: string): Promise<string> {
  const response = await invokeBookmaker({ action: "preview_voice", voice });
  const url = typeof response.url === "string" ? response.url : "";
  if (!response.success || !url) {
    throw new Error(String(response.message || "The narrator preview could not be prepared."));
  }
  return url;
}

export async function getBookmakerEntitlement(): Promise<BookmakerEntitlement> {
  const { data, error } = await supabase.rpc("bookmaker_get_entitlement");
  if (error) {
    console.error("bookmaker entitlement:", error);
    return DEFAULT_ENTITLEMENT;
  }
  return {
    ...DEFAULT_ENTITLEMENT,
    ...((data ?? {}) as Partial<BookmakerEntitlement>),
    costs: { ...DEFAULT_ENTITLEMENT.costs, ...(((data ?? {}) as Partial<BookmakerEntitlement>).costs ?? {}) },
  };
}

export interface BookDownloadResult {
  success: boolean;
  free?: boolean;
  cost?: number;
  download_count?: number;
  download_limit?: number;
  downloads_remaining?: number;
  duplicate?: boolean;
  reason?: string;
  message?: string;
  entitlement?: BookmakerEntitlement;
}

/**
 * Records a PDF download. The server decides whether it falls inside the
 * book's free allowance or costs 1 credit, so the client never grants itself
 * a download.
 */
export async function consumeBookDownload(bookId: string): Promise<BookDownloadResult> {
  const { data, error } = await supabase.rpc("bookmaker_consume_download", {
    p_book_id: bookId,
    p_idempotency_key: makeIdempotencyKey("book_download", bookId),
  });
  if (error) throw error;
  const result = (data ?? {}) as BookDownloadResult;
  if (result.entitlement) {
    result.entitlement = {
      ...DEFAULT_ENTITLEMENT,
      ...result.entitlement,
      costs: { ...DEFAULT_ENTITLEMENT.costs, ...(result.entitlement.costs ?? {}) },
    };
  }
  return result;
}

// Bookmaker rows are owner-scoped in the database. Every query also filters on
// the signed-in member so a client can never render another account's ebook,
// even if a deployment is missing its row-level policies.
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function fetchBookmakerBook(bookId: string): Promise<BookmakerBook | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("bookmaker_books")
    .select("*")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as BookmakerBook) ?? null;
}

export async function listBookmakerBooks(): Promise<BookmakerBook[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  const { data, error } = await supabase
    .from("bookmaker_books")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookmakerBook[];
}

export async function saveBookmakerBook(
  bookId: string,
  patch: Record<string, unknown>,
): Promise<BookmakerBook> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Please sign in to continue.");
  const { data, error } = await supabase
    .from("bookmaker_books")
    // The generated Supabase types in this repo widen `.update()` to `never`,
    // so the already-shaped patch is cast at the boundary.
    .update(patch as never)
    .eq("id", bookId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as BookmakerBook;
}

export async function deleteBookmakerBook(bookId: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) throw new Error("Please sign in to continue.");
  const { error } = await supabase
    .from("bookmaker_books")
    .delete()
    .eq("id", bookId)
    .eq("user_id", userId);
  if (error) throw error;
}

export function rememberBook(bookId: string) {
  try {
    localStorage.setItem("bookmaker:lastBookId", bookId);
  } catch {
    // localStorage can be unavailable in private/sandboxed contexts
  }
}

export function lastRememberedBook(): string | null {
  try {
    return localStorage.getItem("bookmaker:lastBookId");
  } catch {
    return null;
  }
}

export async function uploadBookCover(
  userId: string,
  bookId: string,
  file: File,
): Promise<{ path: string; url: string }> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    throw new Error("Please upload a JPG, PNG or WebP image.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Cover images must be smaller than 8 MB.");
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/${bookId}-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;

  const { data } = await supabase.storage.from(COVER_BUCKET).createSignedUrl(path, MEDIA_URL_TTL);
  return { path, url: data?.signedUrl ?? "" };
}
