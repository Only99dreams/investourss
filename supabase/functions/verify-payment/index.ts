import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * verify-payment: the only path a client may use to activate a paid
 * subscription or credit pack.
 *
 * The activation RPCs are service-role only. This function is the trusted
 * middle: it takes the caller's JWT, confirms the charge really happened and
 * really belongs to them by asking Paystack to verify the reference, then
 * activates server-side. A fabricated reference fails at the Paystack lookup,
 * so a signed-in user can no longer grant themselves free credits or premium
 * (and therefore free voting power).
 *
 * The plan/promo are read from the Paystack metadata recorded at
 * initialisation, not from the request body, so a caller cannot claim a
 * cheaper plan than they paid for.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface PaystackVerify {
  status: boolean;
  message: string;
  data?: {
    status: string;
    reference: string;
    amount: number;
    currency: string;
    metadata?: Record<string, unknown> | null;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!paystackSecret || !supabaseUrl || !serviceKey) {
    console.error("verify-payment: missing server configuration");
    return json({ error: "Server configuration error" }, 500);
  }

  let body: { reference?: string; kind?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const reference = String(body.reference ?? "").trim();
  if (!reference) return json({ error: "reference is required" }, 400);

  // Identify the caller. The client passes its session token automatically via
  // functions.invoke, so this is who is making the claim.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: "Sign in to complete this payment." }, 401);
  }
  const callerId = userData.user.id;

  // Ask Paystack to verify the reference. A reference that was never charged
  // (or does not exist) cannot be verified, which is the whole point.
  let verify: PaystackVerify;
  try {
    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${paystackSecret}` } },
    );
    verify = await res.json();
  } catch (err) {
    console.error("verify-payment: Paystack lookup failed", err);
    return json({ error: "Could not confirm the payment right now." }, 502);
  }

  const tx = verify.data;
  if (!verify.status || !tx || tx.status !== "success") {
    return json({ error: "This payment has not been confirmed by Paystack." }, 402);
  }

  const metadata = (tx.metadata ?? {}) as Record<string, unknown>;
  const metaUserId = typeof metadata.user_id === "string" ? metadata.user_id : null;

  // The charge must belong to the caller. Without this, one member could claim
  // another member's successful charge.
  if (metaUserId && metaUserId !== callerId) {
    return json({ error: "This payment belongs to a different account." }, 403);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const paymentType =
    typeof metadata.payment_type === "string" ? metadata.payment_type : body.kind ?? "";

  if (paymentType === "audit_pack") {
    const { error } = await admin.rpc("activate_audit_pack_payment", {
      p_user_id: callerId,
      p_reference: reference,
      p_amount_kobo: tx.amount,
    });
    if (error) {
      console.error("verify-payment: audit pack activation failed", error);
      return json({ error: error.message }, 500);
    }
    return json({ ok: true, kind: "audit_pack" });
  }

  if (paymentType !== "subscription") {
    return json({ error: "Unknown payment type." }, 400);
  }

  const planType = typeof metadata.plan_type === "string" ? metadata.plan_type : null;
  if (!planType) return json({ error: "Payment is missing its plan." }, 400);
  const promoCodeId =
    typeof metadata.promo_code_id === "string" ? metadata.promo_code_id : null;

  const { error } = await admin.rpc("activate_paystack_subscription", {
    p_user_id: callerId,
    p_reference: reference,
    p_plan_type: planType,
    p_amount_kobo: tx.amount,
    p_promo_code_id: promoCodeId,
  });
  if (error) {
    console.error("verify-payment: subscription activation failed", error);
    return json({ error: error.message }, 500);
  }
  return json({ ok: true, kind: "subscription" });
});
