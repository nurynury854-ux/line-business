import "server-only";

import { SignJWT } from "jose";
import { serverEnv } from "@/lib/env";

/**
 * SERVER ONLY (enforced by the import above). These tokens must never be
 * sent to a browser.
 *
 * Mints the short-lived Supabase access token that carries the identity RLS
 * policies read. It is not a session: it is minted per request, after the LINE
 * ID token has been verified, and expires in seconds (CLAUDE.md §3).
 *
 *
 * ALGORITHM — HS256, with the secret used as its UTF-8 STRING.
 *
 * Not a guess. Probed against this project: the other three plausible
 * combinations (HS256 with the secret base64-decoded to raw bytes, and both
 * HS512 variants) are all rejected by PostgREST with
 *   PGRST301 "No suitable key or wrong key type".
 * If tokens ever start failing with that code, re-probe rather than assuming;
 * rotating to a differently-encoded secret would change the answer.
 *
 *
 * CLAIMS — `role`, `aud` and `exp` are all load-bearing.
 *
 * Every RLS policy is granted `to authenticated`. Without `role` and `aud`,
 * PostgREST maps the request to `anon`, no policy applies, and SELECTs return
 * an EMPTY ARRAY with no error at all. Writes fail loudly; reads lie quietly.
 * That silent-read failure is the reason scripts/verify-role-mapping.mjs
 * exists, and why it compares two identities rather than checking one.
 *
 *
 * NO `sub` CLAIM — on purpose, not an oversight.
 *
 * Supabase's auth.uid() casts `sub` to uuid. A LINE subject looks like
 * "U4af4980629..." and is not a uuid, so including it would make auth.uid()
 * error. No policy in 0001 reads it. Putting the customer's uuid there instead
 * would mean resolving or creating the customer row BEFORE minting — an
 * unauthenticated database write before we hold a token, which is worse than
 * the problem it solves.
 *
 * If some Supabase client path ever turns out to require a `sub`, derive a
 * deterministic v5 UUID from (tenant_id, line_user_id) and use that. Do NOT
 * put the raw LINE subject in. Finding this out under time pressure is the
 * failure mode this paragraph exists to prevent.
 */

/** Long enough to cover one request, short enough to be useless if it leaks. */
const TOKEN_TTL_SECONDS = 30;

function signingKey(): Uint8Array {
  return new TextEncoder().encode(serverEnv.supabaseJwtSecret());
}

async function mint(claims: Record<string, string>): Promise<string> {
  return new SignJWT({ role: "authenticated", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience("authenticated")
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(signingKey());
}

/**
 * Phase one: read exactly one tenant row, by slug, to discover which LINE Login
 * channel to verify against.
 *
 * There is a bootstrap problem here worth naming. The `aud` for verification
 * lives in the tenant row, so the tenant must be read BEFORE any token can be
 * verified — but reading it is itself RLS-governed. This token resolves that by
 * carrying only the slug, which policy tenants_read_by_slug_claim scopes to a
 * single row.
 *
 * The slug arrives unverified from the client, and that is FINE: it only
 * selects which channel to check the token against, and a wrong guess makes
 * verification fail. Do not "harden" this into something that breaks it.
 *
 * It grants nothing else: no tenant_id and no line_user_id claim means every
 * other policy fails closed.
 */
export async function mintTenantLookupToken(tenantSlug: string): Promise<string> {
  // DO NOT ADD A tenant_id CLAIM HERE.
  //
  // The isolation of this token is not enforced by any check — it is the
  // absence of the claim. Every policy in 0001 compares against
  // current_tenant_id(); with no claim that returns NULL, every comparison
  // becomes `col = NULL` which is NULL, and RLS treats non-TRUE as invisible.
  //
  // Adding tenant_id here would satisfy all of those policies at once and
  // silently turn a narrow bootstrap key into a full session token, with no
  // test failing and no error raised. scripts/verify-supabase-tokens.ts asserts on
  // the decoded payload precisely because behaviour alone would not catch it.
  return mint({ tenant_slug: tenantSlug });
}

/**
 * Tenant-scoped READ token: carries tenant_id but no line_user_id.
 *
 * Satisfies the tenant-scoped read policies (services, staff, business_hours,
 * closed_dates, bookings) and NOT the customer-scoped ones — customers_read_self
 * and bookings_insert_self both require a line_user_id claim, so this token can
 * see that a slot is taken but cannot see who took it, and cannot write.
 *
 * Used by the availability endpoint, which has no verified identity to work
 * from: a customer must be able to see what is free before logging in.
 */
export async function mintTenantReadToken(tenantId: string): Promise<string> {
  return mint({ tenant_id: tenantId });
}

/**
 * Phase two: the real request token, minted only AFTER LINE has verified the ID
 * token. `lineUserId` must be the `sub` of the verified token — never a value
 * the client supplied (CLAUDE.md §3).
 */
export async function mintSessionToken(
  tenantId: string,
  lineUserId: string,
): Promise<string> {
  return mint({ tenant_id: tenantId, line_user_id: lineUserId });
}
