/**
 * The tenant configuration contract.
 *
 * Everything a salon needs to differ by lives here. Adding a salon means adding
 * a file next to demo.ts — no component should ever need to change, and no
 * component should ever branch on a tenant id (CLAUDE.md §5).
 *
 * All times in this file are WALL-CLOCK times in Asia/Taipei, written "HH:mm".
 * All dates are calendar dates in Asia/Taipei, written "YYYY-MM-DD". Neither is
 * an instant; conversion to UTC happens in src/lib/time/taipei.ts and nowhere
 * else (CLAUDE.md §4).
 */

/** 0 = Sunday, matching JavaScript's getUTCDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A wall-clock span within one day, e.g. { start: "10:00", end: "14:00" }. */
export type TimeRange = {
  start: string;
  end: string;
};

/**
 * Opening spans per weekday. Multiple spans express a mid-day break
 * (10:00–14:00 plus 15:00–20:00). An empty array means closed that weekday,
 * which is how a recurring day off is expressed.
 */
export type BusinessHours = Record<Weekday, TimeRange[]>;

export type Service = {
  id: string;
  /** Tenant copy, already in the salon's own language. Not an i18n key. */
  name: string;
  description?: string;
  durationMinutes: number;
  priceTwd: number;
};

export type Staff = {
  id: string;
  name: string;
  title?: string;
};

/**
 * MOCK DATA. Stands in for rows the database will own. Delete this type and the
 * bookedSlots field once bookings are read from Supabase.
 */
export type BookedSlot = {
  /** Calendar date in Asia/Taipei, "YYYY-MM-DD". */
  date: string;
  /** Wall-clock start in Asia/Taipei, "HH:mm". */
  start: string;
  durationMinutes: number;
  staffId: string;
};

export type TenantConfig = {
  id: string;
  name: string;
  logoUrl: string;

  /** Fed into CSS custom properties at the root of the flow, never branched on. */
  brand: {
    primary: string;
    onPrimary: string;
    accent: string;
  };

  services: Service[];
  staff: Staff[];
  businessHours: BusinessHours;

  /** One-off closures: holidays, training days. Recurring days off go in businessHours. */
  closedDates: string[];

  booking: {
    /** Spacing of the slot grid. Service duration decides whether a slot fits. */
    slotIntervalMinutes: number;
    /** Slots starting sooner than this from now are not bookable. */
    minimumLeadTimeMinutes: number;
    /** Length of the date picker, counting today as day 1. */
    windowDays: number;
  };

  /** MOCK. Remove with the backend. */
  bookedSlots: BookedSlot[];
};
