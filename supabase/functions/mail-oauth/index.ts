import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scope: string;
  clientId: () => string | undefined;
  clientSecret: () => string | undefined;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  gmail: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    profileUrl: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    clientId: () => Deno.env.get("GMAIL_CLIENT_ID"),
    clientSecret: () => Deno.env.get("GMAIL_CLIENT_SECRET"),
  },
  outlook: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    profileUrl: "https://graph.microsoft.com/v1.0/me",
    scope: "Mail.Read offline_access",
    clientId: () => Deno.env.get("OUTLOOK_CLIENT_ID"),
    clientSecret: () => Deno.env.get("OUTLOOK_CLIENT_SECRET"),
  },
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, ...extra, "Content-Type": "application/json" },
  });
}

function encodeState(data: { user_id: string; provider: string; origin: string }): string {
  return btoa(JSON.stringify(data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeState(state: string): { user_id: string; provider: string; origin: string } {
  const b64 = state.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return JSON.parse(atob(b64 + pad));
}

function buildAuthUrl(provider: string, clientId: string, redirectUri: string, state: string): string {
  const cfg = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: cfg.scope,
    state,
  });
  if (provider === "gmail") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    params.set("include_granted_scopes", "true");
  }
  return `${cfg.authUrl}?${params.toString()}`;
}

async function exchangeCode(provider: string, code: string, redirectUri: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const cfg = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: cfg.clientId()!,
    client_secret: cfg.clientSecret()!,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (provider === "outlook") params.set("scope", cfg.scope);

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token || !data.refresh_token) {
    console.error("token exchange failed:", res.status, data);
    throw new Error(data?.error_description || data?.error || "Token exchange failed");
  }
  return data;
}

async function fetchEmail(provider: string, accessToken: string): Promise<string> {
  const cfg = PROVIDERS[provider];
  const res = await fetch(cfg.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (provider === "gmail") return data?.emailAddress ?? "";
  return data?.mail ?? data?.userPrincipalName ?? "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);

    let action = url.searchParams.get("action");

    // Google/Azure redirect back with ?code=...&state=... (no action param),
    // so automatically treat a request with code/error as the callback.
    if (!action) {
      action =
        url.searchParams.has("code") || url.searchParams.has("error")
          ? "callback"
          : "authorize";
    }

    let provider = url.searchParams.get("provider") ?? "";
    let userId = url.searchParams.get("user_id") ?? "";
    let origin = url.searchParams.get("origin") ?? Deno.env.get("APP_ORIGIN") ?? "";

    if (req.method === "POST" && action === "authorize") {
      const body = await req.json().catch(() => ({}));
      provider = body?.provider ?? provider;
      userId = body?.user_id ?? userId;
      origin = body?.origin ?? origin;
    }

    if (action === "authorize") {
      if (!provider || !PROVIDERS[provider]) return json({ success: false, error: "Unsupported provider." }, 400);
      if (!userId) return json({ success: false, error: "Missing user_id." }, 400);

      const cfg = PROVIDERS[provider];
      const clientId = cfg.clientId();
      if (!clientId) return json({ success: false, error: `${provider} OAuth is not configured yet.` }, 500);

      const redirectUri =
        Deno.env.get("GOOGLE_REDIRECT_URI") ??
        `${url.origin}/mail-oauth`;
      const state = encodeState({ user_id: userId, provider, origin });
      return json({ success: true, url: buildAuthUrl(provider, clientId, redirectUri, state) });
    }

    if (action === "callback") {
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? "";
      const error = url.searchParams.get("error") ?? "";
      if (error) {
        return Response.redirect(`${origin}/auditor/connect?email=error`, 302);
      }
      if (!code || !state) return json({ success: false, error: "Missing code or state." }, 400);

      let decoded: { user_id: string; provider: string; origin: string };
      try {
        decoded = decodeState(state);
      } catch {
        return json({ success: false, error: "Invalid state." }, 400);
      }

      const redirectUri =
        Deno.env.get("GOOGLE_REDIRECT_URI") ??
        `${url.origin}/mail-oauth`;
      const tokens = await exchangeCode(decoded.provider, code, redirectUri);
      const email = await fetchEmail(decoded.provider, tokens.access_token);

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { error: upsertErr } = await supabase.from("email_connections").upsert(
        {
          user_id: decoded.user_id,
          provider: decoded.provider,
          email: email || null,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        },
        { onConflict: "user_id,provider" },
      );
      if (upsertErr) {
        console.error("upsert email_connections failed:", upsertErr);
        return json({ success: false, error: "Failed to save connection." }, 500);
      }

      const appOrigin = decoded.origin || Deno.env.get("APP_ORIGIN") || url.origin;
      return Response.redirect(`${appOrigin}/auditor/connect?email=connected&provider=${decoded.provider}`, 302);
    }

    return json({ success: false, error: "Unknown action." }, 400);
  } catch (err) {
    console.error("mail-oauth error:", err);
    return json({ success: false, error: "OAuth flow failed. Please try again." }, 500);
  }
});
