import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LineTokenVerificationError,
  type VerifiedLineIdentity,
  verifyLineIdToken,
} from "@/lib/line/verify-id-token";
import { createRequestScopedClient } from "@/lib/supabase/client";
import { mintSessionToken, mintTenantLookupToken } from "@/lib/supabase/tokens";

/**
 * The trust-boundary sequence every customer-facing route performs, in the one
 * order that is correct (CLAUDE.md §3):
 *
 *   1. resolve the tenant with a slug-only lookup token
 *   2. verify the ID token against THAT tenant's Login channel
 *   3. only then mint a session token from the verified `sub`
 *
 * Step 1 precedes step 2 because the expected `aud` lives in the tenant row —
 * there is nothing to verify against until the tenant is known. The slug arrives
 * UNVERIFIED from the client and that is fine: it only selects which channel the
 * token is checked against, and a wrong slug makes verification fail.
 *
 * Returns a discriminated result rather than throwing, so a route maps each
 * refusal to its own status code and never leaks a stack trace to the browser.
 */

/**
 * Columns every route needs from the tenant row. Add here, not per route. One
 * literal, not a concatenation: supabase-js parses it at the type level.
 */
const TENANT_COLUMNS =
  "id, slug, name, brand, liff_id, line_login_channel_id, slot_interval_minutes, minimum_lead_time_minutes, booking_window_days, cancellation_cutoff_minutes";

export type SessionTenant = {
  id: string;
  slug: string;
  name: string;
  brand: { primary?: string; onPrimary?: string; accent?: string } | null;
  liff_id: string | null;
  line_login_channel_id: string;
  slot_interval_minutes: number;
  minimum_lead_time_minutes: number;
  booking_window_days: number;
  cancellation_cutoff_minutes: number;
};

export type CustomerSession =
  | {
      ok: true;
      tenant: SessionTenant;
      identity: VerifiedLineIdentity;
      /** Scoped to (tenant, verified line user). Never sent to the browser. */
      client: SupabaseClient;
    }
  | { ok: false; status: 404 | 401 | 500; error: string; detail?: unknown };

export async function authenticateCustomer(
  tenantSlug: string,
  idToken: string,
): Promise<CustomerSession> {
  const lookupClient = createRequestScopedClient(await mintTenantLookupToken(tenantSlug));

  const { data: tenant, error: tenantError } = await lookupClient
    .from("tenants")
    .select(TENANT_COLUMNS)
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (tenantError) {
    return { ok: false, status: 500, error: "Could not resolve tenant.", detail: tenantError.message };
  }
  if (!tenant) return { ok: false, status: 404, error: "Unknown tenant." };

  let identity: VerifiedLineIdentity;
  try {
    identity = await verifyLineIdToken(idToken, tenant.line_login_channel_id);
  } catch (error) {
    if (error instanceof LineTokenVerificationError) {
      return {
        ok: false,
        status: 401,
        error: "LINE ID token verification failed.",
        detail: {
          message: error.message,
          lineError: error.lineError,
          lineErrorDescription: error.lineErrorDescription,
        },
      };
    }
    throw error;
  }

  const client = createRequestScopedClient(
    await mintSessionToken(tenant.id, identity.lineUserId),
  );

  return { ok: true, tenant: tenant as unknown as SessionTenant, identity, client };
}

/**
 * The LIFF URL of a sub-page of the booking app, e.g. "/mine". Null when the
 * tenant has no LIFF app yet, so a Flex button can be omitted rather than
 * pointing nowhere. LIFF appends the path to the registered endpoint, which is
 * why every page lives under /liff/booking (CLAUDE.md, Layout).
 */
export function liffPageUrl(liffId: string | null, path: `/${string}`): string | null {
  return liffId ? `https://liff.line.me/${liffId}${path}` : null;
}
