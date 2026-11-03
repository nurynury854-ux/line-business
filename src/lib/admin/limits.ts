/**
 * What an owner may enter on the settings page. Shared by the routes, which
 * enforce it, and the form, which uses it for maxLength and pickers — so the
 * screen never offers something the server then refuses.
 *
 * No `server-only`: the client component imports this file too.
 */

export const LIMITS = {
  serviceName: 40,
  serviceDescription: 200,
  staffName: 20,
  staffTitle: 20,
  address: 200,
  phone: 30,
  url: 500,
  /** NT$ — high enough for any salon treatment, low enough to catch a typo of three extra zeros. */
  maxPriceTwd: 100_000,
  maxDurationMinutes: 600,
  /** Durations and opening times sit on a 5-minute grid. */
  minuteStep: 5,
} as const;

/** The cancellation cutoffs an owner can pick, in minutes. 0 = up to the start. */
export const CUTOFF_OPTIONS = [0, 60, 120, 180, 360, 720, 1440, 2880] as const;
