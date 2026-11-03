import { NextResponse } from "next/server";
import { badRequest, readAdminRequest, serverError } from "@/lib/admin/request";
import { savedResponse } from "@/lib/admin/catalog";
import { integerIn, wallClock } from "@/lib/admin/validate";

/**
 * POST /api/admin/hours — replaces the salon's whole weekly schedule.
 *
 *   { hours: [{ weekday: 0-6, opensAt: "HH:mm", closesAt: "HH:mm" }, ...] }
 *
 * A weekday with no spans is closed. Times are Asia/Taipei wall clock and are
 * stored as-is: `time` columns hold wall clock, so there is no conversion on
 * this path (CLAUDE.md §4).
 *
 * set_business_hours() (0008) swaps the week in one transaction and re-checks
 * the rules, so a refused save never leaves the salon half-open. Bookings that
 * new hours no longer cover are kept and flagged, never cancelled.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A day split by a lunch break is two spans; more than four is a mistake. */
const MAX_SPANS_PER_DAY = 4;

export async function POST(request: Request) {
  const parsed = await readAdminRequest(request);
  if ("response" in parsed) return parsed.response;
  const { session, body } = parsed;
  const { client } = session;

  if (!Array.isArray(body.hours)) return badRequest("hours must be an array.");

  const spans: { weekday: number; opens_at: string; closes_at: string }[] = [];
  const perDay = new Map<number, number>();
  for (const entry of body.hours as unknown[]) {
    const span = (entry ?? {}) as Record<string, unknown>;
    const weekday = integerIn(span.weekday, 0, 6);
    const opensAt = wallClock(span.opensAt);
    const closesAt = wallClock(span.closesAt);
    // "HH:mm" strings compare correctly as text.
    if (weekday === undefined || !opensAt || !closesAt || closesAt <= opensAt) {
      return badRequest("Invalid opening hours.", { code: "invalid" });
    }
    perDay.set(weekday, (perDay.get(weekday) ?? 0) + 1);
    if ((perDay.get(weekday) ?? 0) > MAX_SPANS_PER_DAY) {
      return badRequest("Too many spans in one day.", { code: "invalid" });
    }
    spans.push({ weekday, opens_at: opensAt, closes_at: closesAt });
  }

  const { data: code, error } = await client.rpc("set_business_hours", { p_hours: spans });
  if (error) return serverError("Could not save hours.", error.message);

  switch (code) {
    case "saved":
      return savedResponse(client);
    case "overlap":
      return badRequest("Two spans on the same day overlap.", { code: "overlap" });
    case "invalid":
      return badRequest("Invalid opening hours.", { code: "invalid" });
    case "not_admin":
      // authenticateAdmin already let this caller through, so the database
      // disagreeing is worth surfacing as itself, not as a generic failure.
      return NextResponse.json({ error: "This LINE account is not an admin of this salon." }, { status: 403 });
    default:
      return serverError("Unexpected result from set_business_hours.", code);
  }
}
