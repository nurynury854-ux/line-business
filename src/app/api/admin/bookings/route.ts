import { NextResponse } from "next/server";
import { readAdminRequest, serverError } from "@/lib/admin/request";
import {
  FLAGGABLE_BOOKING_COLUMNS,
  type FlaggableBookingRow,
  upcomingFlaggedBookings,
} from "@/lib/booking/attention";
import { addCalendarDays, calendarDateInTaipei, taipeiWallClockToInstant } from "@/lib/time/taipei";

/**
 * POST /api/admin/bookings — the salon owner's schedule.
 *
 * Same trust boundary as customer booking, same order: resolve the tenant with a
 * slug-only token, verify the ID token against THAT tenant's channel, then mint
 * a session token from the verified `sub` (CLAUDE.md §3) — all inside
 * authenticateAdmin, which also refuses a non-admin with a clean 403.
 *
 * Authorisation is checked TWICE, independently. The route reads tenant_admins
 * so a non-admin gets a 403 instead of a confusing empty list; and RLS checks
 * membership again via current_is_tenant_admin() before releasing a single
 * customer row. The minted token carries no `is_admin` claim, so a bug in this
 * file cannot grant itself access to customer data.
 *
 * Every booking carries `issues` — a hidden stylist or service, a day off, or
 * hours that no longer cover it — and `attentionCount` counts every upcoming
 * flagged booking, not just this range's, so a problem three weeks out still
 * reaches the banner. Range "attention" lists exactly those bookings.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Today, the next seven days including today (both Asia/Taipei), or every flagged upcoming booking. */
type Range = "today" | "week" | "attention";

export async function POST(request: Request) {
  const parsed = await readAdminRequest(request);
  if ("response" in parsed) return parsed.response;
  const { session, body } = parsed;
  const { client } = session;

  const range: Range = body.range === "week" || body.range === "attention" ? body.range : "today";
  const now = new Date();
  const today = calendarDateInTaipei(now);

  let flagged;
  try {
    flagged = await upcomingFlaggedBookings(client, now);
  } catch (error) {
    return serverError("Could not load bookings.", (error as Error).message);
  }

  let rows: FlaggableBookingRow[];
  let lastDay: string | null;

  if (range === "attention") {
    rows = flagged.map((entry) => entry.row);
    lastDay = null;
  } else {
    lastDay = range === "week" ? addCalendarDays(today, 6) : today;
    const from = taipeiWallClockToInstant(today, "00:00");
    const to = taipeiWallClockToInstant(addCalendarDays(lastDay, 1), "00:00");

    const result = await client
      .from("bookings")
      .select(FLAGGABLE_BOOKING_COLUMNS)
      .neq("status", "cancelled")
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at", { ascending: true });

    if (result.error) return serverError("Could not load bookings.", result.error.message);
    rows = (result.data ?? []) as unknown as FlaggableBookingRow[];
  }

  const issuesById = new Map(flagged.map((entry) => [entry.row.id, entry.issues]));

  const bookings = rows.map((row) => ({
    id: row.id,
    startsAt: row.starts_at,
    status: row.status,
    durationMinutes: row.duration_minutes,
    priceTwd: row.price_twd,
    serviceName: row.services?.name ?? null,
    staffName: row.staff?.name ?? null,
    // Null when the customer booked before the profile scope was enabled.
    customerName: row.customers?.display_name ?? null,
    // Only upcoming confirmed bookings are ever flagged: one that already
    // happened, or is completed, has nothing left for the owner to sort out.
    issues: issuesById.get(row.id) ?? [],
  }));

  return NextResponse.json(
    { range, from: today, to: lastDay, bookings, attentionCount: flagged.length },
    { headers: { "cache-control": "no-store" } },
  );
}
