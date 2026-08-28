/**
 * Sets the demo tenant's per-environment LINE identifiers from .env.local.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/set-tenant-line-ids.ts
 *
 * Why a script and not the seed SQL: liff_id and line_login_channel_id differ
 * per environment, and the Supabase SQL editor cannot read environment
 * variables. Hand-editing the .sql before each run is how a staging id ends up
 * in production.
 *
 * Uses the SERVICE ROLE key, which bypasses RLS. That is allowed here and
 * nowhere near a request path: tenants has no UPDATE policy for `authenticated`
 * by design, because tenant rows are administrative data (CLAUDE.md §2). This
 * file must never be imported by application code.
 *
 * The SEED_ prefix on these variables is deliberate. There is intentionally no
 * runtime env var for a LINE channel id — with one channel per salon it is
 * tenant data, read from the tenant row per request. A seed-time variable does
 * not contradict that: it is how the value gets INTO the row.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";

for (const raw of fs.existsSync(path.join(process.cwd(), ".env.local"))
  ? fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")
  : []) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const at = line.indexOf("=");
  const key = line.slice(0, at).trim();
  if (!(key in process.env)) {
    process.env[key] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const liffId = process.env.SEED_DEMO_LIFF_ID;
  const channelId = process.env.SEED_DEMO_LINE_LOGIN_CHANNEL_ID;

  if (!url || !serviceRoleKey) {
    console.error(
      "Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.\n" +
        "The service role key is required because tenants has no UPDATE policy\n" +
        "for authenticated — that is deliberate, not an oversight.",
    );
    process.exit(2);
  }

  if (!liffId && !channelId) {
    console.error(
      "Nothing to set. Add at least one of these to .env.local:\n" +
        "  SEED_DEMO_LIFF_ID=2000000000-AbCdEfGh\n" +
        "  SEED_DEMO_LINE_LOGIN_CHANNEL_ID=2000000000",
    );
    process.exit(2);
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const patch: Record<string, string> = {};
  if (liffId) patch.liff_id = liffId;
  if (channelId) patch.line_login_channel_id = channelId;

  const { data, error } = await admin
    .from("tenants")
    .update(patch)
    .eq("id", DEMO_TENANT_ID)
    .select("slug, liff_id, line_login_channel_id")
    .single();

  if (error || !data) {
    console.error(`Update failed: ${error?.message ?? "no row matched"}`);
    process.exit(1);
  }

  console.log(`tenant ${data.slug}:`);
  console.log(`  liff_id               ${data.liff_id ?? "(null)"}`);
  console.log(
    `  line_login_channel_id ${
      data.line_login_channel_id === "REPLACE_ME_LOGIN_CHANNEL_ID"
        ? "STILL PLACEHOLDER — set SEED_DEMO_LINE_LOGIN_CHANNEL_ID"
        : data.line_login_channel_id
    }`,
  );
}

main();
