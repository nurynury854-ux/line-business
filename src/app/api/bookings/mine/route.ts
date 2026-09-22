import { NextResponse } from "next/server";
import { authenticateCustomer } from "@/lib/line/customer-session";

/**
 * POST /api/bookings/mine — the caller's own bookings.
 *
 * POST for a read, like /api/admin/bookings: the ID token is a credential, and
 * a GET would put it in a URL where it lands in access logs and history.
 *
 * bookings_read_own_tenant lets a session token see every booking in the tenant
 * (availability needs that), so "mine" is enforced HERE by filtering on the
 * customer row — and customers_read_self guarantees that row can only be the
 * caller's own. A caller with no customer row has simply never booked.
 *
 * `canCancel` and `cancelDeadline` are advisory, for the UI. The database
 * function called by /api/bookings/cancel re-checks everything, so a stale
 * screen cannot cancel past the cutoff.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How far back the history list reaches. Display only, not retention. */
const PAST_DAYS = 90;
const PAST_LIMIT = 20;

type Joined = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  duration_minutes: number;
  price_twd: number;
  services: { name: string } | null;
  staff: { name: string } | null;
};

export async function POST(request: Request) {
  let body: { tenantSlug?: unknown; idToken?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { tenantSlug, idToken } = body;
  if (typeof tenantSlug !== "string" || !tenantSlug) {
    return NextResponse.json({ error: "tenantSlug is required." }, { status: 400 });
  }
  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json({ error: "idToken is required." }, { status: 400 });
  }

  const session = await authenticateCustomer(tenantSlug, idToken);
  if (!session.ok) {
    return NextResponse.json(
      { error: session.error, detail: session.detail },
      { status: session.status },
    );
  }
  const { client, tenant } = session;

  // RLS returns at most the caller's own row here.
  const { data: customer } = await client.from("customers").select("id").maybeSingle();

  const now = new Date();
  const cutoffMs = tenant.cancellation_cutoff_minutes * 60_000;

  if (!customer) {
    return NextResponse.json(
      { upcoming: [], past: [], cutoffMinutes: tenant.cancellation_cutoff_minutes },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const pastFrom = new Date(now.getTime() - PAST_DAYS * 24 * 60 * 60_000);
  const columns =
    "id, starts_at, ends_at, status, duration_minutes, price_twd, services(name), staff(name)";

  const [upcomingResult, pastResult] = await Promise.all([
    client
      .from("bookings")
      .select(columns)
      .eq("customer_id", customer.id)
      .eq("status", "confirmed")
      .gte("starts_at", now.toISOString())
      .order("starts_at", { ascending: true }),
    client
      .from("bookings")
      .select(columns)
      .eq("customer_id", customer.id)
      .lt("starts_at", now.toISOString())
      .gte("starts_at", pastFrom.toISOString())
      .order("starts_at", { ascending: false })
      .limit(PAST_LIMIT),
  ]);

  const error = upcomingResult.error ?? pastResult.error;
  if (error) {
    return NextResponse.json(
      { error: "Could not load bookings.", detail: error.message },
      { status: 500 },
    );
  }

  const shape = (row: Joined) => {
    const startsAt = new Date(row.starts_at);
    const deadline = new Date(startsAt.getTime() - cutoffMs);
    return {
      id: row.id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      durationMinutes: row.duration_minutes,
      priceTwd: row.price_twd,
      serviceName: row.services?.name ?? null,
      staffName: row.staff?.name ?? null,
      cancelDeadline: deadline.toISOString(),
      canCancel: row.status === "confirmed" && deadline.getTime() > now.getTime(),
    };
  };

  return NextResponse.json(
    {
      upcoming: ((upcomingResult.data ?? []) as unknown as Joined[]).map(shape),
      past: ((pastResult.data ?? []) as unknown as Joined[]).map(shape),
      cutoffMinutes: tenant.cancellation_cutoff_minutes,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
