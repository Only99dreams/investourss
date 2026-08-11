import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://investours.com";
const FROM_EMAIL = "Investours <notifications@investours.com>";

type NotificationType =
  | "welcome"
  | "new_post"
  | "post_liked"
  | "post_commented"
  | "new_follower"
  | "subscription_activated"
  | "password_reset_confirm"
  | "comment_replied";

interface NotificationPayload {
  type: NotificationType;
  recipient_id?: string;       // user id to look up email
  recipient_email?: string;    // or pass email directly
  recipient_name?: string;
  actor_name?: string;         // who triggered the action
  post_id?: string;
  post_preview?: string;
  comment_preview?: string;
  plan_type?: string;
}

function buildEmail(payload: NotificationPayload): { subject: string; html: string } | null {
  const name = payload.recipient_name || "there";
  const communityUrl = `${APP_URL}/community`;

  const wrap = (subject: string, body: string) => ({
    subject,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:#1a1a2e;padding:24px 32px;text-align:center;">
          <span style="color:#f5c842;font-size:22px;font-weight:bold;letter-spacing:1px;">INVESTOURS</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          ${body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f4f4f5;padding:20px 32px;text-align:center;font-size:12px;color:#888;">
          <p style="margin:0 0 8px;">You're receiving this because you have an Investours account.</p>
          <p style="margin:0;">© ${new Date().getFullYear()} Investours. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });

  const btn = (url: string, label: string) =>
    `<a href="${url}" style="display:inline-block;background:#f5c842;color:#1a1a2e;font-weight:bold;padding:12px 28px;border-radius:8px;text-decoration:none;margin-top:20px;">${label}</a>`;

  const postUrl = payload.post_id ? `${communityUrl}?post=${payload.post_id}` : communityUrl;
  const preview = payload.post_preview ? `<blockquote style="border-left:3px solid #f5c842;margin:16px 0;padding:8px 16px;color:#555;font-style:italic;">"${payload.post_preview.slice(0, 160)}${payload.post_preview.length > 160 ? "..." : ""}"</blockquote>` : "";

  switch (payload.type) {
    case "welcome":
      return wrap(
        "Welcome to Investours 🎉",
        `<h2 style="color:#1a1a2e;margin:0 0 12px;">Welcome, ${name}!</h2>
        <p style="color:#444;line-height:1.6;">Your Investours account is ready. Here's what you can do:</p>
        <ul style="color:#444;line-height:2;padding-left:20px;">
          <li>🤖 Generate AI-powered business plans</li>
          <li>📚 Learn financial literacy with your AI Tutor</li>
          <li>🔍 Detect investment scams before they hurt you</li>
          <li>🌍 Connect with the Opportunity Hub community</li>
        </ul>
        ${btn(`${APP_URL}/dashboard`, "Go to My Dashboard")}`
      );

    case "new_post":
      return wrap(
        `New post in the Opportunity Hub`,
        `<h2 style="color:#1a1a2e;margin:0 0 12px;">New post from ${payload.actor_name || "a member"}</h2>
        <p style="color:#444;line-height:1.6;">Someone just shared something in the Investours Opportunity Hub:</p>
        ${preview}
        ${btn(postUrl, "View Post")}`
      );

    case "post_liked":
      return wrap(
        `${payload.actor_name || "Someone"} loved your post ❤️`,
        `<h2 style="color:#1a1a2e;margin:0 0 12px;">Hi ${name},</h2>
        <p style="color:#444;line-height:1.6;"><strong>${payload.actor_name || "Someone"}</strong> loved your post on the Opportunity Hub.</p>
        ${preview}
        ${btn(postUrl, "See Your Post")}`
      );

    case "post_commented":
      return wrap(
        `${payload.actor_name || "Someone"} commented on your post 💬`,
        `<h2 style="color:#1a1a2e;margin:0 0 12px;">Hi ${name},</h2>
        <p style="color:#444;line-height:1.6;"><strong>${payload.actor_name || "Someone"}</strong> commented on your post:</p>
        ${payload.comment_preview ? `<blockquote style="border-left:3px solid #f5c842;margin:16px 0;padding:8px 16px;color:#555;font-style:italic;">"${payload.comment_preview.slice(0, 200)}"</blockquote>` : ""}
        ${preview}
        ${btn(postUrl, "Reply in the Hub")}`
      );

    case "comment_replied":
      return wrap(
        `${payload.actor_name || "Someone"} replied to your comment 💬`,
        `<h2 style="color:#1a1a2e;margin:0 0 12px;">Hi ${name},</h2>
        <p style="color:#444;line-height:1.6;"><strong>${payload.actor_name || "Someone"}</strong> replied to your comment:</p>
        ${payload.comment_preview ? `<blockquote style="border-left:3px solid #f5c842;margin:16px 0;padding:8px 16px;color:#555;font-style:italic;">"${payload.comment_preview.slice(0, 200)}"</blockquote>` : ""}
        ${btn(postUrl, "View Thread")}`
      );

    case "new_follower":
      return wrap(
        `${payload.actor_name || "Someone"} is now following you 🎉`,
        `<h2 style="color:#1a1a2e;margin:0 0 12px;">Hi ${name},</h2>
        <p style="color:#444;line-height:1.6;"><strong>${payload.actor_name || "A new member"}</strong> started following you on Investours.</p>
        ${btn(`${APP_URL}/dashboard/followers`, "View Your Followers")}`
      );

    case "subscription_activated":
      return wrap(
        `Your ${payload.plan_type || "Premium"} subscription is active ✅`,
        `<h2 style="color:#1a1a2e;margin:0 0 12px;">Hi ${name}, you're now Premium!</h2>
        <p style="color:#444;line-height:1.6;">Your <strong>${payload.plan_type || "Premium"}</strong> subscription has been activated. You now have full access to:</p>
        <ul style="color:#444;line-height:2;padding-left:20px;">
          <li>✅ Unlimited business plan revisions</li>
          <li>✅ PDF & DOCX plan downloads</li>
          <li>✅ Advanced AI Financial Tutor levels</li>
          <li>✅ Deep scam analysis reports</li>
        </ul>
        ${btn(`${APP_URL}/dashboard`, "Explore Premium Features")}`
      );

    case "password_reset_confirm":
      return wrap(
        "Your Investours password has been changed",
        `<h2 style="color:#1a1a2e;margin:0 0 12px;">Hi ${name},</h2>
        <p style="color:#444;line-height:1.6;">Your Investours account password was successfully changed.</p>
        <p style="color:#444;line-height:1.6;">If you did not make this change, please contact us immediately by replying to this email.</p>
        ${btn(`${APP_URL}/auth`, "Go to Login")}`
      );

    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const payload: NotificationPayload = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve recipient email
    let recipientEmail = payload.recipient_email;
    let recipientName = payload.recipient_name;

    if (!recipientEmail && payload.recipient_id) {
      const { data: userData } = await supabase.auth.admin.getUserById(payload.recipient_id);
      recipientEmail = userData?.user?.email;
      if (!recipientName) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email_opt_in")
          .eq("id", payload.recipient_id)
          .maybeSingle();
        recipientName = profile?.full_name || undefined;

        // Respect email opt-out (except for security emails)
        const securityTypes: NotificationType[] = ["password_reset_confirm", "subscription_activated"];
        if (profile?.email_opt_in === false && !securityTypes.includes(payload.type)) {
          return new Response(JSON.stringify({ skipped: "opted_out" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    if (!recipientEmail) {
      return new Response(JSON.stringify({ error: "No recipient email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = buildEmail({ ...payload, recipient_name: recipientName });
    if (!email) {
      return new Response(JSON.stringify({ error: "Unknown notification type" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send via Resend API
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("RESEND_API_KEY not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [recipientEmail],
        subject: email.subject,
        html: email.html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ error: "Failed to send email", detail: err }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-notification error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});