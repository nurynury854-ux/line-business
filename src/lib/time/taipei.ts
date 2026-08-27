/**
 * The single place where Asia/Taipei wall-clock values become instants, and the
 * only place allowed to do date arithmetic (CLAUDE.md §4).
 *
 * Two distinct kinds of value flow through the app, and conflating them is the
 * bug this module exists to prevent:
 *
 *   CalendarDate  "YYYY-MM-DD"  a date on a Taipei wall calendar, not an instant
 *   WallClock     "HH:mm"       a time on a Taipei wall clock, not an instant
 *   Date                        an actual instant, always compared in UTC
 */

export const TAIPEI_TIME_ZONE = "Asia/Taipei";

/**
 * Taiwan has observed a fixed UTC+8 with no daylight saving since 1979, so a
 * constant offset is correct rather than a shortcut. This is the one place to
 * change if that ever stops being true — nothing else may hardcode it.
 */
const TAIPEI_UTC_OFFSET = "+08:00";

/** "YYYY-MM-DD" on the Taipei calendar. */
export type CalendarDate = string;
/** "HH:mm" on a Taipei wall clock. */
export type WallClock = string;

/** 0 = Sunday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Today's calendar date in Taipei. en-CA is used purely because it formats as
 * YYYY-MM-DD; it is not a UI locale.
 */
export function calendarDateInTaipei(instant: Date): CalendarDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Calendar arithmetic on a date-only value. Done in UTC deliberately: a bare
 * calendar date has no offset to get wrong, so adding days here cannot drift.
 */
export function addCalendarDays(
  date: CalendarDate,
  days: number,
): CalendarDate {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Weekday of a Taipei calendar date. */
export function weekdayOf(date: CalendarDate): Weekday {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday;
}

/**
 * Converts a Taipei wall-clock date+time into a real instant. This is the
 * boundary CLAUDE.md §4 describes: the offset is explicit and named, never
 * inferred from the host machine.
 */
export function taipeiWallClockToInstant(
  date: CalendarDate,
  time: WallClock,
): Date {
  return new Date(`${date}T${time}:00${TAIPEI_UTC_OFFSET}`);
}

/** Minutes since midnight. Pure within-day arithmetic — no timezone involved. */
export function wallClockToMinutes(time: WallClock): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Inverse of wallClockToMinutes, zero-padded. */
export function minutesToWallClock(minutes: number): WallClock {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
