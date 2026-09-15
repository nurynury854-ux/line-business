import { NextResponse } from "next/server";
import {
  LineTokenVerificationError,
  verifyLineIdToken,
} from "@/lib/line/verify-id-token";
import { createRequestScopedClient } from "@/lib/supabase/client";
import { mintSessionToken, mintTenantLookupToken } from "@/lib/supabase/tokens";
import { addCalendarDays, calendarDateInTaipei, taipeiWallClockToInstant } from "@/lib/time/taipei";

/**
 * POST /api/admin/bookings — the salon owner's schedule.
 *
 * Same trust boundary as customer booking, same order: resolve the tenant with a
 * slug-only token, verify the ID token against THAT tenant's channel, then mint
 * a session token from the verified `sub` (CLAUDE.md §3).
 *
 * POST rather than GET for a read, deliberately: the ID token is a credential,
 * and a GET would put it in a URL, where it lands in access logs, proxy logs and
 * browser history.
 *
 * Authorisation is checked TWICE, independently. This route reads tenant_admins
 * so a non-admin gets a clean 403 instead of a confusing empty list; and RLS
 * checks membership again via current_is_tenant_admin() before releasing a
 * single customer row. The minted token carries no `is_admin` claim, so a bug in
 * this file cannot grant itself access to customer data.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Today only, or the next seven days including today — both in Asia/Taipei. */
type Range = "today" | "week";

export async function POST(request: Request) {
  let body: { tenantSlug?: unknown; idToken?: unknown; range?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { tenantSlug, idToken } = body;
  const range: Range = body.range === "week" ? "week" : "today";

  if (typeof tenantSlug !== "string" || !tenantSlug) {
    return NextResponse.json({ error: "tenantSlug is required." }, { status: 400 });
  }
  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json({ error: "idToken is required." }, { status: 400 });
  }

  const lookupClient = createRequestScopedClient(await mintTenantLookupToken(tenantSlug));
  const { data: tenant } = await lookupClient
    .from("tenants")
    .select("id, line_login_channel_id")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (!tenant) return NextResponse.json({ error: "Unknown tenant." }, { status: 404 });

  let identity;
  try {
    identity = await verifyLineIdToken(idToken, tenant.line_login_channel_id);
  } catch (error) {
    if (error instanceof LineTokenVerificationError) {
      return NextResponse.json(
        { error: "LINE ID token verification failed.", detail: error.message },
        { status: 401 },
      );
    }
    throw error;
  }

  const client = createRequestScopedClient(
    await mintSessionToken(tenant.id, identity.lineUserId),
  );

  // First check: is this person an admin at all? RLS would hide the customer
  // rows regardless, but an explicit 403 is a far better answer than a list that
  // silently omits every name.
  const { data: adminRow } = await client
    .from("tenant_admins")
    .select("id, display_name")
    .maybeSingle();

  if (!adminRow) {
    return NextResponse.json(
      { error: "This LINE account is not an admin of this salon." },
      { status: 403 },
    );
  }

  const today = calendarDateInTaipei(new Date());
  const lastDay = range === "week" ? addCalendarDays(today, 6) : today;
  const from = taipeiWallClockToInstant(today, "00:00");
  const to = taipeiWallClockToInstant(addCalendarDays(lastDay, 1), "00:00");

  const { data: rows, error } = await client
    .from("bookings")
    .select(
      "id, starts_at, ends_at, status, duration_minutes, price_twd, " +
        "services(name), staff(name), customers(display_name)",
    )
    .neq("status", "cancelled")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", to.toISOString())
    .order("starts_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Could not load bookings.", detail: error.message },
      { status: 500 },
    );
  }

  type Joined = {
    id: string; starts_at: string; status: string;
    duration_minutes: number; price_twd: number;
    services: { name: string } | null;
    staff: { name: string } | null;
    customers: { display_name: string | null } | null;
  };

  const bookings = ((rows ?? []) as unknown as Joined[]).map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    status: row.status,
    durationMinutes: row.duration_minutes,
    priceTwd: row.price_twd,
    serviceName: row.services?.name ?? null,
    staffName: row.staff?.name ?? null,
    // Null when the customer booked before the profile scope was enabled.
    customerName: row.customers?.display_name ?? null,
  }));

  return NextResponse.json(
    { range, from: today, to: lastDay, bookings },
    { headers: { "cache-control": "no-store" } },
  );
}
