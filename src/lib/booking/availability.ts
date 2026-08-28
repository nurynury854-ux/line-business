import "server-only";

import {
  type CalendarDate,
  type WallClock,
  addCalendarDays,
  calendarDateInTaipei,
  taipeiWallClockToInstant,
  wallClockToMinutes,
  weekdayOf,
} from "@/lib/time/taipei";

/**
 * SERVER-SIDE availability, re-derived from database rows.
 *
 * Deliberately a SECOND implementation of the rules in src/lib/booking/slots.ts,
 * not a shared one. The shapes genuinely differ — the client generates a whole
 * grid from tenant config, the server validates one requested point against
 * database rows — and forcing them through one abstraction would obscure both.
 *
 * The risk that they drift apart is handled by a parity test in
 * scripts/verify-slots.ts, which asserts that for a given day, every slot the
 * client offers passes this check and every slot it refuses fails it. If you
 * change a rule in either file, that test is what tells you the other is stale.
 *
 * Nothing the client asserts about availability is consulted. The client sends
 * a date, a time, a service and a stylist; whether that is bookable is decided
 * here, from business_hours, closed_dates and minimum_lead_time_minutes.
 *
 * TIMEZONE: the Asia/Taipei wall clock the customer chose is converted to an
 * instant EXACTLY ONCE, by taipeiWallClockToInstant below. Everything
 * downstream compares instants. business_hours values are wall clock and are
 * compared as minutes-within-day, which needs no conversion at all
 * (CLAUDE.md §4).
 */

export type BusinessSpan = {
  /** Asia/Taipei wall clock, "HH:mm". */
  opensAt: WallClock;
  closesAt: WallClock;
};

/** An existing booking, as instants straight from timestamptz columns. */
export type ExistingBooking = {
  staffId: string;
  startsAt: Date;
  endsAt: Date;
};

export type SlotRejection =
  | "outside_booking_window"
  | "closed_date"
  | "outside_business_hours"
  | "not_on_slot_grid"
  | "inside_lead_time";

export type SlotDecision =
  | { ok: true; startsAt: Date; endsAt: Date }
  | { ok: false; reason: SlotRejection };

export type SlotRequest = {
  date: CalendarDate;
  time: WallClock;
  serviceDurationMinutes: number;
  spansForWeekday: BusinessSpan[];
  isClosedDate: boolean;
  slotIntervalMinutes: number;
  minimumLeadTimeMinutes: number;
  bookingWindowDays: number;
  now: Date;
};

/**
 * Decides whether one requested wall-clock slot is bookable at all, ignoring
 * who is free. Staff collisions are a separate question — see staffFreeAt.
 */
export function decideSlot(request: SlotRequest): SlotDecision {
  const {
    date, time, serviceDurationMinutes, spansForWeekday, isClosedDate,
    slotIntervalMinutes, minimumLeadTimeMinutes, bookingWindowDays, now,
  } = request;

  const today = calendarDateInTaipei(now);
  const lastBookable = addCalendarDays(today, bookingWindowDays - 1);
  // Calendar dates are zero-padded, so lexicographic order is chronological.
  if (date < today || date > lastBookable) {
    return { ok: false, reason: "outside_booking_window" };
  }

  if (isClosedDate) return { ok: false, reason: "closed_date" };

  const startMinutes = wallClockToMinutes(time);
  const endMinutes = startMinutes + serviceDurationMinutes;

  let landedInsideASpan = false;
  let alignedSpanFound = false;

  for (const span of spansForWeekday) {
    const opens = wallClockToMinutes(span.opensAt);
    const closes = wallClockToMinutes(span.closesAt);

    if (startMinutes < opens || endMinutes > closes) continue;
    landedInsideASpan = true;

    // Grid alignment is measured from each span's own opening time, so the
    // afternoon half of a split day restarts the grid at its own opening
    // rather than continuing the morning's offsets.
    if ((startMinutes - opens) % slotIntervalMinutes === 0) {
      alignedSpanFound = true;
      break;
    }
  }

  if (!landedInsideASpan) return { ok: false, reason: "outside_business_hours" };
  if (!alignedSpanFound) return { ok: false, reason: "not_on_slot_grid" };

  // The ONE conversion from Taipei wall clock to an instant.
  const startsAt = taipeiWallClockToInstant(date, time);
  const endsAt = new Date(startsAt.getTime() + serviceDurationMinutes * 60_000);

  if (startsAt.getTime() < now.getTime() + minimumLeadTimeMinutes * 60_000) {
    return { ok: false, reason: "inside_lead_time" };
  }

  return { ok: true, startsAt, endsAt };
}

/** Half-open overlap: a booking ending exactly when another starts is fine. */
export function overlaps(
  aStart: Date, aEnd: Date, bStart: Date, bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function staffFreeAt(
  staffId: string,
  startsAt: Date,
  endsAt: Date,
  bookings: ExistingBooking[],
): boolean {
  return !bookings.some(
    (booking) =>
      booking.staffId === staffId &&
      overlaps(startsAt, endsAt, booking.startsAt, booking.endsAt),
  );
}

/**
 * Orders stylists least-booked first for the day, so an unassigned booking
 * spreads across the team instead of always landing on whoever sorts first.
 * Ties break on the caller's incoming order, which is staff.sort_order — so the
 * result is deterministic and reproducible in tests.
 */
export function rankStaffByDayLoad(
  staffIds: string[],
  bookingsThatDay: ExistingBooking[],
): string[] {
  const load = new Map(staffIds.map((id) => [id, 0]));
  for (const booking of bookingsThatDay) {
    const current = load.get(booking.staffId);
    if (current !== undefined) load.set(booking.staffId, current + 1);
  }

  return [...staffIds].sort((a, b) => {
    const difference = (load.get(a) ?? 0) - (load.get(b) ?? 0);
    return difference !== 0 ? difference : staffIds.indexOf(a) - staffIds.indexOf(b);
  });
}

/** Taipei-day bounds as instants, for querying overlapping bookings. */
export function taipeiDayBounds(date: CalendarDate): { start: Date; end: Date } {
  return {
    start: taipeiWallClockToInstant(date, "00:00"),
    end: taipeiWallClockToInstant(addCalendarDays(date, 1), "00:00"),
  };
}

export { weekdayOf };
