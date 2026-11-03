/**
 * A tenant slug as it appears in the URL: /liff/booking/{slug}.
 *
 * Each salon's LIFF app registers /liff/booking/{slug} as its endpoint, so the
 * slug is what selects the tenant on every LIFF page. It arrives unverified,
 * which is fine (CLAUDE.md §3) — this check only stops junk reaching the
 * database; an unknown but well-formed slug still resolves to a 404.
 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isTenantSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_PATTERN.test(value);
}

/** The salon's booking home, i.e. its LIFF endpoint. */
export function bookingHomePath(slug: string): string {
  return `/liff/booking/${slug}`;
}
