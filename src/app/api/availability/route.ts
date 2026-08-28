import { NextResponse } from "next/server";
import { createRequestScopedClient } from "@/lib/supabase/client";
import { mintTenantLookupToken, mintTenantReadToken } from "@/lib/supabase/tokens";
import {
  type ExistingBooking,
  buildDaySlots,
  taipeiDayBounds,
  weekdayOf,
} from "@/lib/booking/availability";

/**
 * GET /api/availability — the real slot grid for one date.
 *
 * Deliberately NOT identity-authenticated. A customer has to see what is free
 * before deciding to log in, and requiring an ID token here would put a call to
 * LINE's verify endpoint in front of every grid render.
 *
 * The token it mints carries tenant_id only. That is enough to read the
 * catalogue and to see that a slot is occupied, and NOT enough to read customers
 * or to write anything. The response exposes times and nothing else — no
 * customer, no booking id, no stylist assignment.
 *
 * Availability is public information in any booking system; who booked is not.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tenantSlug = params.get("tenantSlug");
  const serviceId = params.get("serviceId");
  const staffId = params.get("staffId");
  const date = params.get("date");

  if (!tenantSlug || !serviceId || !staffId || !date || !DATE_PATTERN.test(date)) {
    return NextResponse.json(
      { error: "tenantSlug, serviceId, staffId and date (YYYY-MM-DD) are required." },
      { status: 400 },
    );
  }

  const lookupClient = createRequestScopedClient(
    await mintTenantLookupToken(tenantSlug),
  );
  const { data: tenant } = await lookupClient
    .from("tenants")
    .select("id, slot_interval_minutes, minimum_lead_time_minutes, booking_window_days")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (!tenant) return NextResponse.json({ error: "Unknown tenant." }, { status: 404 });

  const client = createRequestScopedClient(await mintTenantReadToken(tenant.id));

  const { data: service } = await client
    .from("services")
    .select("duration_minutes")
    .eq("id", serviceId)
    .eq("is_active", true)
    .maybeSingle();

  if (!service) {
    return NextResponse.json({ error: "Unknown service." }, { status: 400 });
  }

  const bounds = taipeiDayBounds(date);
  const [{ data: spans }, { data: closed }, { data: staffRows }, { data: bookingRows }] =
    await Promise.all([
      client.from("business_hours").select("opens_at, closes_at").eq("weekday", weekdayOf(date)),
      client.from("closed_dates").select("closed_on").eq("closed_on", date),
      client.from("staff").select("id").eq("is_active", true).order("sort_order"),
      client
        .from("bookings")
        .select("staff_id, starts_at, ends_at")
        .neq("status", "cancelled")
        .gt("ends_at", bounds.start.toISOString())
        .lt("starts_at", bounds.end.toISOString()),
    ]);

  const allStaffIds = (staffRows ?? []).map((row) => row.id as string);
  // "any" competes against the whole team; a named stylist only against himself.
  const staffIds = staffId === "any" ? allStaffIds : [staffId];

  const bookings: ExistingBooking[] = (bookingRows ?? []).map((row) => ({
    staffId: row.staff_id as string,
    startsAt: new Date(row.starts_at as string),
    endsAt: new Date(row.ends_at as string),
  }));

  const slots = buildDaySlots({
    request: {
      date,
      serviceDurationMinutes: service.duration_minutes,
      spansForWeekday: (spans ?? []).map((row) => ({
        opensAt: String(row.opens_at).slice(0, 5),
        closesAt: String(row.closes_at).slice(0, 5),
      })),
      isClosedDate: (closed ?? []).length > 0,
      slotIntervalMinutes: tenant.slot_interval_minutes,
      minimumLeadTimeMinutes: tenant.minimum_lead_time_minutes,
      bookingWindowDays: tenant.booking_window_days,
      now: new Date(),
    },
    staffIds,
    bookings,
  });

  return NextResponse.json({ date, slots }, {
    headers: { "cache-control": "no-store" },
  });
}
