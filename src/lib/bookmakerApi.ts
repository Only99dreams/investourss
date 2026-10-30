import { supabase } from "@/integrations/supabase/client";
import {
  type BookmakerBook,
  type BookmakerEntitlement,
  DEFAULT_ENTITLEMENT,
} from "./bookmaker";

const COVER_BUCKET = "bookmaker-covers";

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
  | "assemble_audiobook";

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
    if (response && typeof response.json === "function") {
      try {
        const payload = await response.clone().json();
        if (payload && typeof payload === "object") return payload as BookmakerResponse;
      } catch {
        // fall through to the generic message
      }
    }
    throw new Error(error.message || "Bookmaker could not complete that request.");
  }

  return (data ?? { success: false, message: "No response from Bookmaker." }) as BookmakerResponse;
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

export async function fetchBookmakerBook(bookId: string): Promise<BookmakerBook | null> {
  const { data, error } = await supabase
    .from("bookmaker_books")
    .select("*")
    .eq("id", bookId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as BookmakerBook) ?? null;
}

export async function listBookmakerBooks(): Promise<BookmakerBook[]> {
  const { data, error } = await supabase
    .from("bookmaker_books")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as BookmakerBook[];
}

export async function saveBookmakerBook(
  bookId: string,
  patch: Record<string, unknown>,
): Promise<BookmakerBook> {
  const { data, error } = await supabase
    .from("bookmaker_books")
    // The generated Supabase types in this repo widen `.update()` to `never`,
    // so the already-shaped patch is cast at the boundary.
    .update(patch as never)
    .eq("id", bookId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as BookmakerBook;
}

export async function deleteBookmakerBook(bookId: string): Promise<void> {
  const { error } = await supabase.from("bookmaker_books").delete().eq("id", bookId);
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

export async function uploadBookCover(userId: string, bookId: string, file: File): Promise<string> {
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

  const { data } = supabase.storage.from(COVER_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
