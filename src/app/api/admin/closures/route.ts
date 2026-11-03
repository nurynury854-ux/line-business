import { badRequest, readAdminRequest, serverError } from "@/lib/admin/request";
import { savedResponse } from "@/lib/admin/catalog";
import { calendarDate } from "@/lib/admin/validate";
import { calendarDateInTaipei } from "@/lib/time/taipei";

/**
 * POST /api/admin/closures — the owner adds or removes a day off.
 *
 *   { action: "add" | "remove", date: "YYYY-MM-DD" }
 *
 * The date is a Taipei calendar date, the same frame closed_dates is stored in;
 * "today" is Taipei's today, never the server's (CLAUDE.md §4). Adding a day
 * that already has bookings is allowed: they stay, and are flagged.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Postgres unique_violation: the day is already off, which is the goal. */
const UNIQUE_VIOLATION = "23505";

export async function POST(request: Request) {
  const parsed = await readAdminRequest(request);
  if ("response" in parsed) return parsed.response;
  const { session, body } = parsed;
  const { client } = session;

  const date = calendarDate(body.date);
  if (!date) return badRequest("Invalid date.");

  if (body.action === "add") {
    if (date < calendarDateInTaipei(new Date())) return badRequest("Date is in the past.", { code: "past" });
    const { error } = await client.from("closed_dates").insert({ tenant_id: session.tenant.id, closed_on: date });
    if (error && error.code !== UNIQUE_VIOLATION) return serverError("Could not save.", error.message);
    return savedResponse(client);
  }

  if (body.action === "remove") {
    const { error } = await client.from("closed_dates").delete().eq("closed_on", date);
    if (error) return serverError("Could not save.", error.message);
    return savedResponse(client);
  }

  return badRequest("Unknown action.");
}
