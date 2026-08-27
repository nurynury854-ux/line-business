import type { BookedSlot, TenantConfig } from "@config/tenants/types";
import {
  type CalendarDate,
  type WallClock,
  addCalendarDays,
  calendarDateInTaipei,
  minutesToWallClock,
  taipeiWallClockToInstant,
  wallClockToMinutes,
  weekdayOf,
} from "@/lib/time/taipei";

/** "any" means the customer did not request a specific stylist. */
export const ANY_STAFF = "any" as const;
export type StaffSelection = typeof ANY_STAFF | string;

export type DayOption = {
  date: CalendarDate;
  /** False when the salon is shut: weekly day off or a one-off closure. */
  isOpen: boolean;
  isToday: boolean;
};

export type SlotUnavailableReason = "past" | "booked";

export type Slot = {
  start: WallClock;
  isAvailable: boolean;
  reason?: SlotUnavailableReason;
};

/** True when the salon is open at all on this date. */
export function isSalonOpen(
  tenant: TenantConfig,
  date: CalendarDate,
): boolean {
  if (tenant.closedDates.includes(date)) return false;
  return tenant.businessHours[weekdayOf(date)].length > 0;
}

/**
 * The date picker's range: `windowDays` days counting today as day 1, so a
 * window of 14 is today through today+13.
 */
export function buildDateOptions(
  tenant: TenantConfig,
  now: Date,
): DayOption[] {
  const today = calendarDateInTaipei(now);

  return Array.from({ length: tenant.booking.windowDays }, (_, offset) => {
    const date = addCalendarDays(today, offset);
    return {
      date,
      isOpen: isSalonOpen(tenant, date),
      isToday: offset === 0,
    };
  });
}

/** Half-open overlap: touching intervals do not collide. */
function overlaps(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA;
}

function collidesWith(
  booking: BookedSlot,
  slotStart: number,
  slotEnd: number,
): boolean {
  const bookedStart = wallClockToMinutes(booking.start);
  return overlaps(
    slotStart,
    slotEnd,
    bookedStart,
    bookedStart + booking.durationMinutes,
  );
}

/**
 * Slots for one date, one service, one staff selection.
 *
 * Spacing comes from `slotIntervalMinutes`, so the grid is stable across
 * services; the service's duration only decides whether a slot still fits
 * before the salon closes. A slot that runs past closing is never offered —
 * it is absent, not disabled, because it was never a real option.
 *
 * Unavailable slots ARE returned, carrying a reason, because the UI shows them
 * disabled rather than hiding them.
 */
export function generateSlots(options: {
  tenant: TenantConfig;
  date: CalendarDate;
  serviceId: string;
  staffId: StaffSelection;
  now: Date;
}): Slot[] {
  const { tenant, date, serviceId, staffId, now } = options;

  if (!isSalonOpen(tenant, date)) return [];

  const service = tenant.services.find((entry) => entry.id === serviceId);
  if (!service) return [];

  const earliestBookable =
    now.getTime() + tenant.booking.minimumLeadTimeMinutes * 60_000;

  // "any" competes against every stylist; a named stylist only against their own.
  const relevantStaffIds =
    staffId === ANY_STAFF
      ? tenant.staff.map((member) => member.id)
      : [staffId];

  const bookingsToday = tenant.bookedSlots.filter(
    (booking) =>
      booking.date === date && relevantStaffIds.includes(booking.staffId),
  );

  const slots: Slot[] = [];

  for (const span of tenant.businessHours[weekdayOf(date)]) {
    const spanStart = wallClockToMinutes(span.start);
    const spanEnd = wallClockToMinutes(span.end);

    for (
      let start = spanStart;
      start + service.durationMinutes <= spanEnd;
      start += tenant.booking.slotIntervalMinutes
    ) {
      const end = start + service.durationMinutes;
      const startTime = minutesToWallClock(start);

      if (
        taipeiWallClockToInstant(date, startTime).getTime() < earliestBookable
      ) {
        slots.push({ start: startTime, isAvailable: false, reason: "past" });
        continue;
      }

      // With "any", the slot only dies once every stylist is occupied.
      const blockedStaff = new Set(
        bookingsToday
          .filter((booking) => collidesWith(booking, start, end))
          .map((booking) => booking.staffId),
      );

      const isBooked = relevantStaffIds.every((id) => blockedStaff.has(id));

      slots.push(
        isBooked
          ? { start: startTime, isAvailable: false, reason: "booked" }
          : { start: startTime, isAvailable: true },
      );
    }
  }

  return slots;
}
