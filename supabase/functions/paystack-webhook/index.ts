import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
};

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) return new Response("Missing secret", { status: 500 });

  const signature = req.headers.get("x-paystack-signature") ?? "";
  const body = await req.text();

  const valid = await verifySignature(body, signature, secret);
  if (!valid) return new Response("Invalid signature", { status: 401 });

  const event = JSON.parse(body);
  if (event.event !== "charge.success") return new Response("OK", { status: 200 });

  const { reference, metadata, amount, status } = event.data;
  if (status !== "success") return new Response("OK", { status: 200 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const userId: string = metadata?.user_id;
  const paymentType: string = metadata?.payment_type ?? "subscription";

  if (!userId) {
    console.error("Missing metadata", metadata);
    return new Response("Missing metadata", { status: 400 });
  }

  if (paymentType === "audit_pack") {
    // Activate an audit credit pack order.
    const { error } = await supabase.rpc("activate_audit_pack_payment", {
      p_user_id: userId,
      p_reference: reference,
      p_amount_kobo: amount,
    });

    if (error) {
      console.error("RPC error:", error);
      return new Response("RPC failed", { status: 500 });
    }

    return new Response("OK", { status: 200 });
  }

  const planType: string = metadata?.plan_type;
  const promoCodId: string | null = metadata?.promo_code_id ?? null;

  if (!planType) {
    console.error("Missing metadata", metadata);
    return new Response("Missing metadata", { status: 400 });
  }

  const { error } = await supabase.rpc("activate_paystack_subscription", {
    p_user_id: userId,
    p_reference: reference,
    p_plan_type: planType,
    p_amount_kobo: amount,
    p_promo_code_id: promoCodId,
  });

  if (error) {
    console.error("RPC error:", error);
    return new Response("RPC failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});