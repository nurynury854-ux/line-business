/**
 * Proves the minted Supabase JWT actually maps to the `authenticated` Postgres
 * role — which the algorithm probe could NOT show, because with no seeded rows
 * "role applied correctly" and "role ignored, treated as anon" both return [].
 *
 * Run AFTER supabase/seed_demo_tenant.sql:
 *   node scripts/verify-role-mapping.mjs
 *
 * Reads .env.local. The secret is never printed.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET = process.env.SUPABASE_JWT_SECRET;

if (!URL_BASE || !ANON_KEY || !SECRET) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY or " +
      "SUPABASE_JWT_SECRET in .env.local",
  );
  process.exit(2);
}

const b64url = (input) =>
  Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * HS256, secret used as its UTF-8 string — verified against this project; the
 * base64-decoded and HS512 variants are rejected with PGRST301.
 *
 * `role` and `aud` are what make PostgREST run the request as `authenticated`.
 * Without them every `to authenticated` policy fails closed and SELECTs return
 * an empty array with no error at all — which is exactly what this script
 * exists to catch. No `sub`: Supabase's auth.uid() casts it to uuid and a LINE
 * subject is not one. (If some client path ever demands a sub, derive a v5 uuid
 * from tenant_id + line_user_id rather than putting the LINE subject in.)
 */
function mint(claims) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({
    role: "authenticated", aud: "authenticated",
    iat, exp: iat + 60, ...claims,
  }));
  const sig = crypto.createHmac("sha256", Buffer.from(SECRET, "utf8"))
    .update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64url(sig)}`;
}

async function query(pathAndQuery, token) {
  const headers = { apikey: ANON_KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, { headers });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { status: res.status, rows: Array.isArray(parsed) ? parsed : null, text };
}

const token = mint({ tenant_id: DEMO_TENANT_ID, line_user_id: "verification-probe" });

const asAnon = await query("tenants?select=id,name,slug", null);
const asAuth = await query("tenants?select=id,name,slug", token);
const services = await query(
  `services?select=id,name&tenant_id=eq.${DEMO_TENANT_ID}`, token);

const count = (r) => (r.rows ? r.rows.length : `non-array (${r.status})`);

console.log("Querying tenants, same URL, two identities:\n");
console.log(`  anon (apikey only)        status ${asAnon.status}  rows: ${count(asAnon)}`);
console.log(`    ${asAnon.text.slice(0, 120)}`);
console.log(`  minted JWT (authenticated) status ${asAuth.status}  rows: ${count(asAuth)}`);
console.log(`    ${asAuth.text.slice(0, 120)}`);
console.log(`\n  services visible to the token: ${count(services)} (expect 5)`);
console.log(`    ${services.text.slice(0, 120)}\n`);

const anonRows = asAnon.rows?.length ?? -1;
const authRows = asAuth.rows?.length ?? -1;

console.log("=".repeat(72));
if (authRows === 1 && anonRows === 0) {
  const ok = services.rows?.length === 5;
  console.log("PASS: the minted JWT maps to `authenticated`.");
  console.log("  The token sees the seeded tenant; anon sees nothing. RLS is");
  console.log("  scoping by the tenant_id claim, exactly as the policies intend.");
  console.log(ok
    ? "  Services scoped correctly too (5 rows)."
    : `  BUT services returned ${count(services)}, expected 5 — check the seed.`);
  process.exit(ok ? 0 : 1);
} else if (authRows === 0 && anonRows === 0) {
  console.log("FAIL: role mapping is UNVERIFIED — both identities returned [].");
  console.log("");
  console.log("  Two causes look identical from out here, so do not assume:");
  console.log("    1. the seed has not run — check its report showed tenant OK");
  console.log("    2. `role`/`aud` are not reaching PostgREST, so the token is");
  console.log("       being treated as anon and every policy fails closed");
  console.log("");
  console.log("  If the seed definitely ran, it is cause 2, and the backend");
  console.log("  cannot be trusted until it is fixed. Do NOT read this as");
  console.log("  'the seed worked'.");
  process.exit(1);
} else if (anonRows > 0) {
  console.log("FAIL: anon can read tenant rows. RLS is not filtering.");
  console.log("  This is worse than a role-mapping bug: data is public.");
  process.exit(1);
} else {
  console.log(`INCONCLUSIVE: anon=${count(asAnon)}, token=${count(asAuth)}.`);
  console.log("  Neither the pass nor the known failure shapes. Read the bodies above.");
  process.exit(1);
}
