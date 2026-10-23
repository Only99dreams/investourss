import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Admin broadcast mailer.
 *
 * The browser never sees the Resend key: this function verifies that the caller
 * is an admin from their JWT, then sends the supplied message to the recipients
 * in the request. The dashboard batches recipients so a large audience does not
 * run past the function timeout.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resend requires a verified domain/sender. Use ADMIN_MAIL_FROM to override
// (e.g. "Investours <onboarding@resend.dev>" for testing, or your verified domain).
// Resend requires a verified domain/sender. Prefer ADMIN_MAIL_FROM, else use the verified investours.app domain.
const FROM_EMAIL = Deno.env.get("ADMIN_MAIL_FROM") || "Investours <notifications@investours.app>";
const MAX_RECIPIENTS = 25;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 20000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Recipient {
  id?: string;
  email: string;
  name?: string;
}

interface MailRequest {
  subject?: string;
  message?: string;
  recipients?: Recipient[];
  includeOptedOut?: boolean;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function messageHtml(message: string): string {
  // Keep intentional paragraph breaks while making the text safe in HTML.
  return message
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="color:#444;line-height:1.65;margin:0 0 16px;">${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function buildEmail(subject: string, message: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#1a1a2e;padding:24px 32px;text-align:center;">
          <span style="color:#f5c842;font-size:22px;font-weight:bold;letter-spacing:1px;">INVESTOURS</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="color:#1a1a2e;font-size:22px;margin:0 0 20px;">${escapeHtml(subject)}</h1>
          ${messageHtml(message)}
        </td></tr>
        <tr><td style="background:#f4f4f5;padding:20px 32px;text-align:center;font-size:12px;color:#888;">
          <p style="margin:0 0 8px;">You're receiving this because you have an Investours account.</p>
          <p style="margin:0;">© ${new Date().getFullYear()} Investours. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendOne(resendKey: string, to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });

    if (res.ok) return { ok: true };

    const detail = await res.text();
    // Resend rate-limits aggressively; retry those and transient upstream errors.
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(1000 * (attempt + 1));
      continue;
    }

    return { ok: false, error: `${to}: ${res.status} ${detail.slice(0, 200)}` };
  }

  return { ok: false, error: `${to}: retries exhausted` };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader) return json({ error: "Sign in required" }, 401);
    if (!resendKey) {
      console.error("RESEND_API_KEY not set");
      return json({ error: "Email service not configured" }, 500);
    }

    // Identify the caller from their JWT, never from the request body.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Sign in required" }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!adminRole) return json({ error: "Admin access required" }, 403);

    const body = (await req.json()) as MailRequest;
    const subject = (body.subject ?? "").trim();
    const message = (body.message ?? "").trim();
    const includeOptedOut = body.includeOptedOut === true;
    const incoming = Array.isArray(body.recipients) ? body.recipients : [];

    if (!subject || subject.length > MAX_SUBJECT) {
      return json({ error: `Subject is required and must be ${MAX_SUBJECT} characters or fewer.` }, 400);
    }
    if (!message || message.length > MAX_MESSAGE) {
      return json({ error: `Message is required and must be ${MAX_MESSAGE} characters or fewer.` }, 400);
    }
    if (incoming.length === 0 || incoming.length > MAX_RECIPIENTS) {
      return json({ error: `Send between 1 and ${MAX_RECIPIENTS} recipients per request.` }, 400);
    }

    // Deduplicate and validate before touching the email provider.
    const seen = new Set<string>();
    const recipients: Recipient[] = [];
    for (const recipient of incoming) {
      const email = String(recipient?.email ?? "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || seen.has(email)) continue;
      seen.add(email);
      recipients.push({
        id: typeof recipient?.id === "string" ? recipient.id : undefined,
        email,
        name: typeof recipient?.name === "string" ? recipient.name : undefined,
      });
    }

    if (recipients.length === 0) return json({ error: "No valid recipient emails were supplied." }, 400);

    // Re-check the opt-out flag server-side so a modified client cannot bypass it.
    const optedOut = new Set<string>();
    const ids = recipients.map((r) => r.id).filter((id): id is string => Boolean(id));
    if (ids.length > 0 && !includeOptedOut) {
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("id, email_opt_in")
        .in("id", ids);
      for (const profile of profiles ?? []) {
        if (profile.email_opt_in === false) optedOut.add(profile.id);
      }
    }

    const html = buildEmail(subject, message);
    const errors: string[] = [];
    let sent = 0;
    let skipped = 0;

    // Sequential, not parallel: Resend's default rate limit is low and a burst
    // of 25 concurrent requests would fail more often than it helps.
    for (const recipient of recipients) {
      if (recipient.id && optedOut.has(recipient.id)) {
        skipped += 1;
        continue;
      }

      const result = await sendOne(resendKey, recipient.email, subject, html);
      if (result.ok) sent += 1;
      else if (result.error) errors.push(result.error);
    }

    return json({
      sent,
      skipped,
      failed: errors.length,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error("send-admin-mail error:", error);
    return json({ error: String(error instanceof Error ? error.message : error) }, 500);
  }
});
