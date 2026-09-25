import { supabase } from "@/integrations/supabase/client";

const SESSION_KEY = "investours_referral_code";
const LOCAL_KEY = "investours_referral_code";

/**
 * Referral codes are generated as `INV` + 8 hex chars (uppercase). Normalise
 * whatever arrives in the URL so a shared link always matches, even if the
 * sender lower-cased it or the reader typed it with spaces.
 */
export function normalizeReferralCode(value: string | null | undefined): string {
  if (!value) return "";
  const cleaned = value.replace(/\s+/g, "").toUpperCase();
  if (!cleaned || cleaned === "NULL" || cleaned === "UNDEFINED") return "";
  return cleaned;
}

/** Persist a captured code so it survives navigation before signup happens. */
export function captureReferralCode(value: string | null | undefined): string {
  const code = normalizeReferralCode(value);
  if (!code) return "";
  try {
    sessionStorage.setItem(SESSION_KEY, code);
    localStorage.setItem(LOCAL_KEY, code);
  } catch {
    /* storage unavailable (private mode) — non-fatal */
  }
  return code;
}

/** The referral code attached to this browsing session, if any. */
export function readReferralCode(): string {
  try {
    return (
      normalizeReferralCode(sessionStorage.getItem(SESSION_KEY)) ||
      normalizeReferralCode(localStorage.getItem(LOCAL_KEY))
    );
  } catch {
    return "";
  }
}

export function clearReferralCode(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

export function buildReferralLink(code: string | null | undefined): string {
  return `${window.location.origin}/signup?ref=${normalizeReferralCode(code)}`;
}

interface RpcResult {
  data: unknown;
  error: unknown;
}

/**
 * The generated `Database` types predate these referral RPCs, so a direct
 * `supabase.rpc(...)` call narrows its arguments to `never`. Funnel through
 * this one loose signature instead of scattering casts across components.
 */
export async function callReferralRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult> {
  const rpc = supabase.rpc as unknown as (
    name: string,
    params: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
  return rpc(fn, args);
}

export interface ReferralLookup {
  valid: boolean;
  referrerName?: string | null;
}

interface ResolvedCode {
  found: boolean;
  referrer_name: string | null;
}

/**
 * Best-effort validation of a referral code. The RPC may not exist yet on an
 * older database, so any failure resolves to "assume valid" and lets the
 * server-side attribution at signup be the source of truth.
 */
export async function verifyReferralCode(code: string): Promise<ReferralLookup> {
  const clean = normalizeReferralCode(code);
  if (!clean) return { valid: false };
  try {
    const res = await callReferralRpc("resolve_referral_code", {
      p_referral_code: clean,
    });
    if (res.error) return { valid: true };
    const rows = Array.isArray(res.data) ? (res.data as ResolvedCode[]) : [];
    const row = rows[0];
    if (!row) return { valid: true };
    return { valid: Boolean(row.found), referrerName: row.referrer_name ?? null };
  } catch {
    return { valid: true };
  }
}
