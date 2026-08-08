import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_PASSWORD_RESET_SECRET = Deno.env.get("ADMIN_PASSWORD_RESET_SECRET");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ADMIN_PASSWORD_RESET_SECRET) {
  throw new Error("Missing required Supabase environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function listAllUsers() {
  const users: { id: string; email?: string | null }[] = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
  }
  return users;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: {
    secret?: string;
    scope?: "all" | "single";
    email?: string;
    password?: string;
    clearFlag?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Invalid JSON body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (body.secret !== ADMIN_PASSWORD_RESET_SECRET) {
    return new Response(JSON.stringify({ success: false, error: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const password = body.password ?? "12345678";

  if (body.scope === "all") {
    let authUsers: { id: string; email?: string | null }[];
    try {
      authUsers = await listAllUsers();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ success: false, error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    let updated = 0;
    const failures: { email: string | null; error: string }[] = [];
    const BATCH = 20;
    for (let i = 0; i < authUsers.length; i += BATCH) {
      const batch = authUsers.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (user) => {
          const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
          if (error) return { email: user.email ?? user.id, error: error.message };
          return null;
        })
      );
      for (const result of results) {
        if (result) failures.push(result);
        else updated += 1;
      }
    }

    let flagError: string | null = null;
    if (body.clearFlag !== false) {
      const { error } = await supabase
        .from("profiles")
        .update({ must_reset_password: false })
        .eq("must_reset_password", true);
      flagError = error?.message ?? null;
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Password set for ${updated} of ${authUsers.length} users.`,
        updated,
        total: authUsers.length,
        failures: failures.slice(0, 20),
        flagError,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const email = body.email?.trim().toLowerCase() ?? "admin@investours.com";

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (profileError) {
    return new Response(JSON.stringify({ success: false, error: profileError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!profile || !profile.id) {
    return new Response(JSON.stringify({ success: false, error: "User not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(profile.id, {
    password,
  });

  if (updateError) {
    return new Response(JSON.stringify({ success: false, error: updateError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error: profileUpdateError } = await supabase
    .from("profiles")
    .update({ must_reset_password: false })
    .eq("id", profile.id);

  if (profileUpdateError) {
    return new Response(JSON.stringify({ success: false, error: profileUpdateError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true, message: "Password updated successfully." }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
