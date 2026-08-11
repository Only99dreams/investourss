import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Broad Nigerian bank-alert matching: sender domains first, then alert-style subjects.
const BANK_SENDER_RE = /(gtbank|zenith\s?bank|firstbank|first\s?bank|uba|access\s?bank|union\s?bank|fidelity\s?bank|stanbic|kuda|opay|palmpay|moniepoint|paystack|flutterwave|providus|wema|sterling|ecobank|keystone|fcmb|coronation|gtb|interswitch|alerts@|no-?reply@|noreply@|no_reply@)/i;
const ALERT_SUBJECT_RE = /(alert|credit|debit|withdraw|transfer|payment|transaction|statement|avail\s?bal|sent\s?ngn|received\s?ngn|otp|bank|account)/i;
const ALERT_ACTION_RE = /(alert|debit|credit|withdraw|transfer|avail\s?bal|sent\s?ngn|received\s?ngn)/i;

function matchesBankCriteria(subject: string, from: string): boolean {
  const s = subject ?? "";
  const f = from ?? "";
  return BANK_SENDER_RE.test(f) || (ALERT_SUBJECT_RE.test(s) && ALERT_ACTION_RE.test(s));
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- OAuth helpers (Gmail API + Microsoft Graph) ---

const OAUTH_PROVIDERS: Record<string, { tokenUrl: string; scope: string; clientId: () => string | undefined; clientSecret: () => string | undefined }> = {
  gmail: {
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    clientId: () => Deno.env.get("GMAIL_CLIENT_ID"),
    clientSecret: () => Deno.env.get("GMAIL_CLIENT_SECRET"),
  },
  outlook: {
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "Mail.Read offline_access",
    clientId: () => Deno.env.get("OUTLOOK_CLIENT_ID"),
    clientSecret: () => Deno.env.get("OUTLOOK_CLIENT_SECRET"),
  },
};

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function refreshAccessToken(provider: string, refreshToken: string): Promise<string> {
  const cfg = OAUTH_PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: cfg.clientId()!,
    client_secret: cfg.clientSecret()!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: cfg.scope,
  });
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.error("refresh token failed:", res.status, data);
    throw new Error(data?.error_description || data?.error || "Failed to refresh access token");
  }
  return data.access_token as string;
}

function gmailQuery(months: number): string {
  const senders = [
    "from:gtbank", "from:zenith", "from:firstbank", "from:first+bank",
    "from:ubabank", "from:accessbank", "from:access", "from:stanbic",
    "from:ecobank", "from:kudabank", "from:opay", "from:palmpay",
    "from:moniepoint", "from:paystack", "from:flutterwave", "from:unionbankng",
    "from:fidelity", "from:wema", "from:sterling",
  ].join(" OR ");
  const subject = "subject:(alert OR debit OR credit OR withdraw OR \"avail bal\" OR balance OR transaction)";
  return `(${senders} OR ${subject}) newer_than:${months}m`;
}

function extractHeaders(text: string): { from: string; subject: string } {
  const from = text.match(/^From:\s*(.+)$/m)?.[1] ?? "";
  const subject = text.match(/^Subject:\s*(.+)$/m)?.[1] ?? "";
  return { from, subject };
}

async function fetchViaGmail(accessToken: string, months: number): Promise<{ matched: number; fetched: number; text: string }> {
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(gmailQuery(months))}&maxResults=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const listData = await listRes.json();
  if (!listRes.ok) {
    throw new Error(listData?.error?.message || "Gmail API request failed");
  }
  const ids: string[] = (listData?.messages ?? []).map((m: { id: string }) => m.id);
  const texts: string[] = [];
  let fetched = 0;
  for (const id of ids.slice(0, 50)) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=raw`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const msgData = await msgRes.json();
    if (!msgRes.ok || !msgData?.raw) continue;
    fetched += 1;
    const decoded = new TextDecoder().decode(base64UrlToBytes(msgData.raw));
    const text = stripHtml(decoded);
    if (text.length <= 10) continue;
    const { from, subject } = extractHeaders(text);
    if (!matchesBankCriteria(subject, from)) continue;
    texts.push(text);
    if (texts.length >= 50) break;
  }
  return { matched: texts.length, fetched, text: texts.join("\n\n").slice(0, 60000) };
}

async function fetchViaOutlook(accessToken: string, months: number): Promise<{ matched: number; fetched: number; text: string }> {
  const since = new Date();
  since.setMonth(since.getMonth() - Math.max(1, Math.min(24, Number(months) || 6)));
  const filter = `receivedDateTime ge ${since.toISOString()}`;
  const url = `https://graph.microsoft.com/v1.0/me/messages?$select=subject,from,body,receivedDateTime&$top=100&$filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Microsoft Graph request failed");
  }
  const texts: string[] = [];
  let fetched = 0;
  for (const msg of data?.value ?? []) {
    fetched += 1;
    const subject = msg?.subject ?? "";
    const from = msg?.from?.emailAddress?.address ?? "";
    if (!matchesBankCriteria(subject, from)) continue;
    const body = msg?.body?.content ?? "";
    const text = stripHtml(body);
    if (text.length <= 10) continue;
    texts.push(`From: ${from}\nSubject: ${subject}\n${text}`);
    if (texts.length >= 50) break;
  }
  return { matched: texts.length, fetched, text: texts.join("\n\n").slice(0, 60000) };
}

async function fetchOAuth(
  provider: string,
  refreshToken: string,
  months: number,
  test: boolean,
): Promise<{ success: boolean; connected: boolean; matched: number; fetched?: number; text?: string }> {
  const accessToken = await refreshAccessToken(provider, refreshToken);
  const { matched, fetched, text } =
    provider === "gmail"
      ? await fetchViaGmail(accessToken, months)
      : await fetchViaOutlook(accessToken, months);

  if (test) return { success: true, connected: true, matched };
  return { success: true, connected: true, matched, fetched, text };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      provider = 'gmail',
      months = 6,
      test = false,
      refreshToken = '',
    } = body;

    // OAuth-only: one-click Gmail/Outlook connect (no app password needed).
    if (!refreshToken || (provider !== 'gmail' && provider !== 'outlook')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Connect your Gmail or Outlook account in one click to fetch bank messages.' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    try {
      const result = await fetchOAuth(provider, refreshToken, months, test);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error('financial-email oauth error:', err);
      const message = String((err as Error)?.message || err);
      const friendly = /refresh/i.test(message)
        ? 'Your email connection expired. Reconnect your email to continue.'
        : message || 'Could not fetch from the connected email account.';
      return new Response(JSON.stringify({ success: false, error: friendly }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error('financial-email error:', err);
    const message = String((err as Error)?.message || err);
    const friendly = message || 'Could not fetch from the connected email account.';
    return new Response(JSON.stringify({ success: false, error: friendly }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
