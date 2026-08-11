import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPA_URL;
const key = process.env.SRV;
const password = process.argv[2] ?? "12345678";

if (!url || !key) {
  console.error("Missing SUPA_URL / SRV env vars");
  process.exit(1);
}

const supabase = createClient(url, key);

console.log("Listing auth users...");
const users = [];
let page = 1;
const perPage = 1000;
while (true) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
  if (error) {
    console.error("listUsers failed:", JSON.stringify(error));
    process.exit(1);
  }
  users.push(...data.users);
  if (data.users.length < perPage) break;
  page += 1;
}
console.log(`Found ${users.length} users.`);

let updated = 0;
const failures = [];
const BATCH = 20;
for (let i = 0; i < users.length; i += BATCH) {
  const batch = users.slice(i, i + BATCH);
  const results = await Promise.all(
    batch.map(async (u) => {
      const { error } = await supabase.auth.admin.updateUserById(u.id, { password });
      if (error) return { email: u.email ?? u.id, error: error.message };
      return null;
    })
  );
  for (const r of results) {
    if (r) failures.push(r);
    else updated += 1;
  }
  console.log(`batch ${i / BATCH + 1}: ok so far ${updated}, failures ${failures.length}`);
}

console.log("Clearing must_reset_password for all profiles...");
const { error: flagError } = await supabase
  .from("profiles")
  .update({ must_reset_password: false })
  .eq("must_reset_password", true);

console.log(JSON.stringify({ updated, total: users.length, failures: failures.slice(0, 20), flagError: flagError?.message ?? null }, null, 2));
