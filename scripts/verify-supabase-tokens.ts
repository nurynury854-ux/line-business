/**
 * Exercises the REAL minting and client code against the live project —
 * src/lib/supabase/tokens.ts and client.ts, not a reimplementation.
 *
 * Supersedes the earlier hand-rolled verify-role-mapping.mjs: same guarantees,
 * but a pass here means the shipping code path works, not merely that the
 * algorithm choice was right.
 *
 *   NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-supabase-tokens.ts
 *
 * The condition flag is required. The modules under test import "server-only",
 * whose default export THROWS outside a React Server build; Next resolves it to
 * an empty module via the "react-server" export condition, and this makes plain
 * node do the same. Without it the script dies on import with
 * "This module cannot be imported from a Client Component module".
 */
import fs from "node:fs";
import path from "node:path";

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

// Static imports are safe: serverEnv reads process.env lazily, inside the
// accessor functions, so nothing touches env at module load.
import { mintSessionToken, mintTenantLookupToken } from "@/lib/supabase/tokens";
import { createRequestScopedClient } from "@/lib/supabase/client";

const DEMO_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const DEMO_SLUG = "demo";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
}

async function main() {
  // --- session token: the everyday request identity -------------------------
  const sessionToken = await mintSessionToken(DEMO_TENANT_ID, "verification-probe");
  const asSession = createRequestScopedClient(sessionToken);

  const tenantRead = await asSession.from("tenants").select("id,name,slug");
  check(
    "session token reads exactly its own tenant",
    tenantRead.data?.length === 1 && tenantRead.data[0].slug === DEMO_SLUG,
    tenantRead.error ? `error: ${tenantRead.error.message}` : `rows: ${tenantRead.data?.length}`,
  );

  const serviceRead = await asSession.from("services").select("id,name");
  check(
    "session token reads the tenant's 5 services",
    serviceRead.data?.length === 5,
    serviceRead.error ? `error: ${serviceRead.error.message}` : `rows: ${serviceRead.data?.length}`,
  );

  // --- lookup token: phase one, slug only -----------------------------------
  const lookupToken = await mintTenantLookupToken(DEMO_SLUG);
  const asLookup = createRequestScopedClient(lookupToken);

  const bootstrap = await asLookup
    .from("tenants")
    .select("id,slug,line_login_channel_id")
    .eq("slug", DEMO_SLUG)
    .maybeSingle();

  const bootstrapWorks = bootstrap.data?.id === DEMO_TENANT_ID;
  check(
    "lookup token resolves the tenant by slug (needs migration 0003)",
    bootstrapWorks,
    bootstrap.error
      ? `error: ${bootstrap.error.message}`
      : bootstrap.data
        ? `channel id present: ${Boolean(bootstrap.data.line_login_channel_id)}`
        : "no row — migration 0003 has probably not been run",
  );

  // The lookup token must be a narrow key, not a general one. Every policy in
  // 0001 keys off current_tenant_id(), which reads a claim this token does not
  // carry -- so each comparison is `col = NULL`, which is NULL, which RLS treats
  // as not-visible. Demonstrated per table rather than argued.
  const walledOff: string[] = [];
  for (const table of ["services", "staff", "business_hours", "closed_dates", "customers", "bookings"]) {
    const probe = await asLookup.from(table).select("*");
    const rows = probe.data?.length ?? 0;
    if (rows !== 0) walledOff.push(`${table}=${rows}`);
  }
  check(
    "lookup token reads NOTHING but its one tenant row",
    walledOff.length === 0,
    walledOff.length === 0
      ? "services, staff, business_hours, closed_dates, customers, bookings: all 0 rows"
      : `LEAKED: ${walledOff.join(", ")}`,
  );

  // --- the INVARIANT the isolation rests on ---------------------------------
  // The probe above tests behaviour. This tests the structural fact behind it:
  // if a tenant_id claim ever appears in this token, every 0001 policy is
  // satisfied at once and the isolation is gone — while the behavioural probe
  // could still pass for unrelated reasons.
  const lookupPayload = JSON.parse(
    Buffer.from(lookupToken.split(".")[1], "base64url").toString("utf8"),
  ) as Record<string, unknown>;

  check(
    "lookup token payload has NO tenant_id key at all",
    !("tenant_id" in lookupPayload),
    `claims present: ${Object.keys(lookupPayload).sort().join(", ")}`,
  );
  check(
    "lookup token payload has NO line_user_id key at all",
    !("line_user_id" in lookupPayload),
    `tenant_slug = ${JSON.stringify(lookupPayload.tenant_slug)}`,
  );

  // --- a token with no claims must see nothing ------------------------------
  const anonish = createRequestScopedClient(await mintSessionToken("", ""));
  const anonRead = await anonish.from("tenants").select("id");
  check(
    "token with empty claims sees no tenants",
    (anonRead.data?.length ?? 0) === 0,
    `rows: ${anonRead.data?.length ?? 0}`,
  );

    console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);

}

main();
