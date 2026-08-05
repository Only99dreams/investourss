import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import ImapFlow from "npm:imapflow@1.0.180";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PROVIDER_HOSTS: Record<string, string> = {
  gmail: "imap.gmail.com",
  outlook: "outlook.office365.com",
  yahoo: "imap.mail.yahoo.com",
  icloud: "imap.mail.me.com",
  other: "",
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      provider = 'gmail',
      host = '',
      email = '',
      appPassword = '',
      months = 6,
    } = body;

    if (!email || !appPassword) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email and app password are required.' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const imapHost = host || PROVIDER_HOSTS[provider];
    if (!imapHost) {
      return new Response(
        JSON.stringify({ success: false, error: 'Select a provider or enter a custom IMAP host.' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const since = new Date();
    since.setMonth(since.getMonth() - Math.max(1, Math.min(24, Number(months) || 6)));

    const client = new ImapFlow({
      host: imapHost,
      port: 993,
      secure: true,
      auth: { user: email, pass: appPassword },
      logger: false,
    });

    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    let result;
    try {
      const uids = await client.search({ since }, { uid: true });
      const recent = (uids ?? []).slice(-300);

      const matches: { uid: number; subject: string; from: string }[] = [];
      if (recent.length > 0) {
        for await (const msg of client.fetch(recent, { envelope: true }, { uid: true })) {
          const subject = msg.envelope?.subject ?? '';
          const from = (msg.envelope?.from ?? [])
            .map((a: { address?: string }) => a.address ?? '')
            .join(', ');
          if (matchesBankCriteria(subject, from)) {
            matches.push({ uid: msg.uid, subject, from });
          }
        }
      }

      const matchedUids = matches.slice(-50).map((m) => m.uid);
      const texts: string[] = [];
      for (const uid of matchedUids) {
        const raw = await client.fetchOne(uid, { source: true }, { uid: true });
        if (raw?.source) {
          const decoded = stripHtml(raw.source.toString('utf-8'));
          if (decoded.length > 10) texts.push(decoded);
        }
      }

      const text = texts.join('\n\n').slice(0, 60000);
      result = { success: true, matched: matches.length, fetched: matchedUids.length, text };
    } finally {
      await lock.release();
    }

    await client.logout().catch(() => {});

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error('financial-email error:', err);
    const message = String((err as Error)?.message || err);
    let friendly = 'Could not connect to the email server. Check your credentials and try again.';
    if (/AUTHENTICATE|AUTH|LOGIN|authentication/i.test(message)) {
      friendly = "Authentication failed. Check your email and app password (Gmail/Yahoo: enable 'App Password' in your account settings).";
    } else if (/connection|timed out|ECONN|ENOTFOUND|ETIMEDOUT|connect/i.test(message)) {
      friendly = 'Could not reach the email server. Verify the host address and your connection.';
    }
    return new Response(JSON.stringify({ success: false, error: friendly }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
