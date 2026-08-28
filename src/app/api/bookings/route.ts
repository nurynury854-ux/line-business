import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LineTokenVerificationError,
  verifyLineIdToken,
} from "@/lib/line/verify-id-token";
import { createRequestScopedClient } from "@/lib/supabase/client";
import { mintSessionToken, mintTenantLookupToken } from "@/lib/supabase/tokens";
import {
  type ExistingBooking,
  decideSlot,
  rankStaffByDayLoad,
  staffFreeAt,
  taipeiDayBounds,
  weekdayOf,
} from "@/lib/booking/availability";

/**
 * POST /api/bookings — create a booking.
 *
 * Assumes a hostile client throughout. The browser sends a TOKEN, never an
 * identity, and never anything this route trusts about availability.
 *
 * Order matters and is not rearrangeable:
 *
 *   1. reject any body carrying an identity field           -> 400
 *   2. resolve the tenant with a slug-only lookup token
 *   3. verify the ID token against THAT tenant's channel     -> 401
 *   4. only now mint a session token, from the verified sub
 *   5. re-derive availability from the database
 *   6. insert; the exclusion constraint is the real guarantee
 *
 * Step 2 precedes step 3 because the expected `aud` lives in the tenant row —
 * there is nothing to verify against until the tenant is known. tenantSlug
 * therefore arrives UNVERIFIED, and that is fine: it only selects which channel
 * the token is checked against, and a wrong slug makes verification fail. Do
 * not "harden" this into something that breaks it (CLAUDE.md §3).
 */

export const runtime = "nodejs";

/** SQLSTATE for an exclusion constraint violation — bookings_no_staff_overlap. */
const EXCLUSION_VIOLATION = "23P01";

const ANY_STAFF = "any";

/**
 * Identity must be DERIVED, never accepted. A body carrying any of these is
 * rejected outright rather than ignored: silently dropping the field would let
 * a caller believe they had set the booking's owner.
 */
const FORBIDDEN_IDENTITY_FIELDS = [
  "userid", "user_id", "lineuserid", "line_user_id",
  "customerid", "customer_id", "sub", "profile", "displayname", "display_name",
];

type BookingRequestBody = {
  tenantSlug?: unknown;
  idToken?: unknown;
  serviceId?: unknown;
  staffId?: unknown;
  date?: unknown;
  time?: unknown;
};

function fail(status: number, error: string, detail?: unknown) {
  return NextResponse.json(
    detail === undefined ? { error } : { error, detail },
    { status },
  );
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export async function POST(request: Request) {
  // --- 1. body ------------------------------------------------------------
  let body: BookingRequestBody;
  try {
    body = (await request.json()) as BookingRequestBody;
  } catch {
    return fail(400, "Request body must be JSON.");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return fail(400, "Request body must be a JSON object.");
  }

  const offending = Object.keys(body).filter((key) =>
    FORBIDDEN_IDENTITY_FIELDS.includes(key.toLowerCase()),
  );
  if (offending.length > 0) {
    return fail(
      400,
      "Request body contained an identity field, which is never accepted.",
      {
        fields: offending,
        why:
          "The booking's owner is derived from the verified LINE ID token's " +
          "subject. A client-supplied identity is not ignored, it is refused, " +
          "so that no caller can believe it took effect.",
      },
    );
  }

  const { tenantSlug, idToken, serviceId, staffId, date, time } = body;

  if (typeof tenantSlug !== "string" || tenantSlug === "") return fail(400, "tenantSlug is required.");
  if (typeof idToken !== "string" || idToken === "") return fail(400, "idToken is required.");
  if (typeof serviceId !== "string" || serviceId === "") return fail(400, "serviceId is required.");
  if (typeof staffId !== "string" || staffId === "") return fail(400, "staffId is required ('any' for no preference).");
  if (typeof date !== "string" || !DATE_PATTERN.test(date)) return fail(400, "date must be YYYY-MM-DD (Asia/Taipei).");
  if (typeof time !== "string" || !TIME_PATTERN.test(time)) return fail(400, "time must be HH:mm (Asia/Taipei).");

  // --- 2. resolve the tenant (slug-only token, reads one row) -------------
  const lookupClient = createRequestScopedClient(
    await mintTenantLookupToken(tenantSlug),
  );

  const { data: tenant, error: tenantError } = await lookupClient
    .from("tenants")
    .select(
      "id, slug, line_login_channel_id, slot_interval_minutes, minimum_lead_time_minutes, booking_window_days",
    )
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (tenantError) return fail(500, "Could not resolve tenant.", tenantError.message);
  if (!tenant) return fail(404, "Unknown tenant.");

  // --- 3. verify the ID token against THIS tenant's channel ---------------
  let identity;
  try {
    identity = await verifyLineIdToken(idToken, tenant.line_login_channel_id);
  } catch (error) {
    if (error instanceof LineTokenVerificationError) {
      return fail(401, "LINE ID token verification failed.", {
        message: error.message,
        lineError: error.lineError,
        lineErrorDescription: error.lineErrorDescription,
      });
    }
    throw error;
  }

  // --- 4. session token, from the VERIFIED subject ------------------------
  const client = createRequestScopedClient(
    await mintSessionToken(tenant.id, identity.lineUserId),
  );

  // --- 5. re-derive availability from the database ------------------------
  const now = new Date();

  const { data: service } = await client
    .from("services")
    .select("id, name, duration_minutes, price_twd")
    .eq("id", serviceId)
    .eq("is_active", true)
    .maybeSingle();

  if (!service) return fail(400, "Unknown or inactive service for this tenant.");

  const [{ data: spans }, { data: closed }] = await Promise.all([
    client
      .from("business_hours")
      .select("opens_at, closes_at")
      .eq("weekday", weekdayOf(date)),
    client.from("closed_dates").select("closed_on").eq("closed_on", date),
  ]);

  const decision = decideSlot({
    date,
    time,
    serviceDurationMinutes: service.duration_minutes,
    spansForWeekday: (spans ?? []).map((row) => ({
      // business_hours stores `time`, which PostgREST renders as "HH:MM:SS".
      opensAt: String(row.opens_at).slice(0, 5),
      closesAt: String(row.closes_at).slice(0, 5),
    })),
    isClosedDate: (closed ?? []).length > 0,
    slotIntervalMinutes: tenant.slot_interval_minutes,
    minimumLeadTimeMinutes: tenant.minimum_lead_time_minutes,
    bookingWindowDays: tenant.booking_window_days,
    now,
  });

  if (!decision.ok) {
    return fail(422, "That time is not bookable.", { reason: decision.reason });
  }

  const { startsAt, endsAt } = decision;

  // Every booking that touches this Taipei day, including one starting the
  // previous day and running over: the filter is on the interval, not the date.
  const bounds = taipeiDayBounds(date);
  const { data: bookingRows } = await client
    .from("bookings")
    .select("staff_id, starts_at, ends_at")
    .neq("status", "cancelled")
    .gt("ends_at", bounds.start.toISOString())
    .lt("starts_at", bounds.end.toISOString());

  const existing: ExistingBooking[] = (bookingRows ?? []).map((row) => ({
    staffId: row.staff_id as string,
    startsAt: new Date(row.starts_at as string),
    endsAt: new Date(row.ends_at as string),
  }));

  const { data: staffRows } = await client
    .from("staff")
    .select("id")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  const activeStaffIds = (staffRows ?? []).map((row) => row.id as string);
  if (activeStaffIds.length === 0) return fail(422, "This salon has no bookable staff.");

  // --- resolve which stylist actually takes the booking -------------------
  let candidates: string[];
  if (staffId === ANY_STAFF) {
    candidates = rankStaffByDayLoad(activeStaffIds, existing).filter((id) =>
      staffFreeAt(id, startsAt, endsAt, existing),
    );
    if (candidates.length === 0) return fail(409, "That slot is fully booked.");
  } else {
    if (!activeStaffIds.includes(staffId)) {
      return fail(400, "Unknown or inactive staff member for this tenant.");
    }
    if (!staffFreeAt(staffId, startsAt, endsAt, existing)) {
      return fail(409, "That stylist is already booked at that time.");
    }
    candidates = [staffId];
  }

  // --- 6. customer, then insert ------------------------------------------
  const { data: customer, error: customerError } = await client
    .from("customers")
    .upsert(
      {
        tenant_id: tenant.id,
        line_user_id: identity.lineUserId,
        display_name: identity.displayName ?? null,
        picture_url: identity.pictureUrl ?? null,
      },
      { onConflict: "tenant_id,line_user_id" },
    )
    .select("id")
    .single();

  if (customerError || !customer) {
    return fail(500, "Could not record the customer.", customerError?.message);
  }

  /**
   * The availability check above races: two requests can both pass it and both
   * insert. bookings_no_staff_overlap is what actually prevents the double
   * booking, and 23P01 is it firing — an expected outcome under concurrency,
   * not a server fault, so it must never surface as a 500.
   *
   * For "any", losing the race means the chosen stylist was taken between our
   * read and our insert; the next-least-booked candidate may still be free, so
   * we retry ONCE. For an explicitly chosen stylist there is no alternative to
   * fall back to, and for a second failure we stop rather than walking the
   * whole team — the client should re-read availability at that point.
   */
  const attempts = staffId === ANY_STAFF ? candidates.slice(0, 2) : candidates.slice(0, 1);

  for (const [index, candidateStaffId] of attempts.entries()) {
    const { data: created, error } = await insertBooking(client, {
      tenantId: tenant.id,
      customerId: customer.id,
      serviceId: service.id,
      staffId: candidateStaffId,
      startsAt,
      durationMinutes: service.duration_minutes,
      priceTwd: service.price_twd,
    });

    if (!error && created) {
      return NextResponse.json(
        {
          booking: created,
          service: { id: service.id, name: service.name },
          reassigned: index > 0,
        },
        { status: 201 },
      );
    }

    if (error?.code !== EXCLUSION_VIOLATION) {
      return fail(500, "Could not create the booking.", error?.message);
    }
    // 23P01: fall through to the next candidate, if this was an "any" request.
  }

  return fail(409, "That slot was just taken. Please choose another time.");
}

async function insertBooking(
  client: SupabaseClient,
  values: {
    tenantId: string;
    customerId: string;
    serviceId: string;
    staffId: string;
    startsAt: Date;
    durationMinutes: number;
    priceTwd: number;
  },
) {
  return client
    .from("bookings")
    .insert({
      tenant_id: values.tenantId,
      customer_id: values.customerId,
      service_id: values.serviceId,
      staff_id: values.staffId,
      // The only instant written. ends_at is computed by a database trigger, so
      // it cannot disagree with starts_at + duration.
      starts_at: values.startsAt.toISOString(),
      duration_minutes: values.durationMinutes,
      price_twd: values.priceTwd,
      status: "confirmed",
    })
    .select("id, starts_at, ends_at, staff_id, service_id, status, price_twd, duration_minutes")
    .single();
}
