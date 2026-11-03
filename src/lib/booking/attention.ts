import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type CalendarDate,
  type WallClock,
  calendarDateInTaipei,
  wallClockInTaipei,
  wallClockToMinutes,
  weekdayOf,
} from "@/lib/time/taipei";

/**
 * Why an existing booking needs the owner's attention.
 *
 * Owners may hide a stylist or service, add a day off, or shorten hours while
 * bookings already sit there. None of that cancels anything (the owner's
 * decision: allow, then warn). Instead the booking is flagged here, every time
 * the schedule is read, until the owner sorts it out with the customer.
 *
 * Derived, never stored: a flag that is computed from the current rows cannot
 * go stale when the owner changes their mind and re-opens a day.
 */
export type BookingIssue = "staff_hidden" | "service_hidden" | "closed_day" | "outside_hours";

export type AttentionContext = {
  /** weekday -> spans, as minutes-within-day on the Taipei wall clock. */
  hours: Map<number, { opens: number; closes: number }[]>;
  closedDates: Set<CalendarDate>;
};

export type FlaggableBooking = {
  startsAt: Date;
  durationMinutes: number;
  staffActive: boolean;
  serviceActive: boolean;
};

/** Reads the tenant rows the flags depend on, through the caller's RLS client. */
export async function loadAttentionContext(client: SupabaseClient): Promise<AttentionContext> {
  const [hours, closed] = await Promise.all([
    client.from("business_hours").select("weekday, opens_at, closes_at"),
    client.from("closed_dates").select("closed_on"),
  ]);
  if (hours.error) throw new Error(hours.error.message);
  if (closed.error) throw new Error(closed.error.message);

  const byWeekday = new Map<number, { opens: number; closes: number }[]>();
  for (const row of hours.data ?? []) {
    const weekday = Number(row.weekday);
    const spans = byWeekday.get(weekday) ?? [];
    spans.push({
      // `time` columns arrive as "HH:MM:SS".
      opens: wallClockToMinutes(String(row.opens_at).slice(0, 5) as WallClock),
      closes: wallClockToMinutes(String(row.closes_at).slice(0, 5) as WallClock),
    });
    byWeekday.set(weekday, spans);
  }

  return {
    hours: byWeekday,
    closedDates: new Set((closed.data ?? []).map((row) => String(row.closed_on))),
  };
}

export function bookingIssues(booking: FlaggableBooking, context: AttentionContext): BookingIssue[] {
  const issues: BookingIssue[] = [];
  if (!booking.staffActive) issues.push("staff_hidden");
  if (!booking.serviceActive) issues.push("service_hidden");

  // The booking's own Taipei date and wall clock — the same frame the hours
  // and days off are written in (CLAUDE.md §4).
  const date = calendarDateInTaipei(booking.startsAt);
  if (context.closedDates.has(date)) {
    issues.push("closed_day");
  } else {
    // Same containment test as decideSlot: the whole appointment must fit in
    // one span. Grid alignment is ignored; an off-grid booking is still served.
    const start = wallClockToMinutes(wallClockInTaipei(booking.startsAt));
    const end = start + booking.durationMinutes;
    const spans = context.hours.get(weekdayOf(date)) ?? [];
    if (!spans.some((span) => start >= span.opens && end <= span.closes)) {
      issues.push("outside_hours");
    }
  }

  return issues;
}

/**
 * The select that feeds bookingIssues, for routes that read bookings with the
 * join. One literal, not a concatenation: supabase-js parses it at the type
 * level.
 */
export const FLAGGABLE_BOOKING_COLUMNS =
  "id, starts_at, status, duration_minutes, price_twd, services(name, is_active), staff(name, is_active), customers(display_name)";

export type FlaggableBookingRow = {
  id: string;
  starts_at: string;
  status: string;
  duration_minutes: number;
  price_twd: number;
  services: { name: string; is_active: boolean } | null;
  staff: { name: string; is_active: boolean } | null;
  customers: { display_name: string | null } | null;
};

export function issuesForRow(row: FlaggableBookingRow, context: AttentionContext): BookingIssue[] {
  return bookingIssues(
    {
      startsAt: new Date(row.starts_at),
      durationMinutes: row.duration_minutes,
      staffActive: row.staff?.is_active ?? false,
      serviceActive: row.services?.is_active ?? false,
    },
    context,
  );
}

/**
 * Upcoming confirmed bookings that currently need attention. Write routes call
 * this after a change, so the owner is told at once how many customers to
 * contact; the schedule's "attention" range lists the same set.
 */
export async function upcomingFlaggedBookings(
  client: SupabaseClient,
  now: Date,
): Promise<{ row: FlaggableBookingRow; issues: BookingIssue[] }[]> {
  const [context, bookings] = await Promise.all([
    loadAttentionContext(client),
    client
      .from("bookings")
      .select(FLAGGABLE_BOOKING_COLUMNS)
      .eq("status", "confirmed")
      .gte("starts_at", now.toISOString())
      .order("starts_at", { ascending: true }),
  ]);
  if (bookings.error) throw new Error(bookings.error.message);

  return ((bookings.data ?? []) as unknown as FlaggableBookingRow[])
    .map((row) => ({ row, issues: issuesForRow(row, context) }))
    .filter((entry) => entry.issues.length > 0);
}
