import { NextResponse } from "next/server";
import { authenticateCustomer, liffPageUrl } from "@/lib/line/customer-session";
import { buildBookingCancelledMessage } from "@/lib/line/booking-cancelled";
import { pushToLineUser } from "@/lib/line/push";
import { serverEnv } from "@/lib/env";
import { t } from "@/i18n";

/**
 * POST /api/bookings/cancel — a customer cancels their own booking.
 *
 * Same trust boundary as booking (CLAUDE.md §3), then ONE database call:
 * cancel_own_booking() owns the rule. It checks ownership, status and the
 * salon's cutoff inside a row lock and returns a code; this route only turns the
 * code into a status the screen can explain. The cutoff is never evaluated in
 * JavaScript, so the screen's "can cancel" hint and the real decision cannot
 * disagree for long, and a stale tab cannot slip past the deadline.
 *
 * The confirmation push is best-effort, like the booking confirmation: the
 * cancellation stands whether or not LINE accepts the message.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Outcome =
  | "cancelled"
  | "not_found"
  | "already_cancelled"
  | "not_cancellable"
  | "past"
  | "too_late";

/** HTTP status per outcome. 422 is "understood, refused by the rule". */
const STATUS_FOR: Record<Exclude<Outcome, "cancelled">, number> = {
  not_found: 404,
  already_cancelled: 409,
  not_cancellable: 422,
  past: 422,
  too_late: 422,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: { tenantSlug?: unknown; idToken?: unknown; bookingId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { tenantSlug, idToken, bookingId } = body;
  if (typeof tenantSlug !== "string" || !tenantSlug) {
    return NextResponse.json({ error: "tenantSlug is required." }, { status: 400 });
  }
  if (typeof idToken !== "string" || !idToken) {
    return NextResponse.json({ error: "idToken is required." }, { status: 400 });
  }
  if (typeof bookingId !== "string" || !UUID_PATTERN.test(bookingId)) {
    return NextResponse.json({ error: "bookingId must be a uuid." }, { status: 400 });
  }

  const session = await authenticateCustomer(tenantSlug, idToken);
  if (!session.ok) {
    return NextResponse.json(
      { error: session.error, detail: session.detail },
      { status: session.status },
    );
  }
  const { client, tenant, identity } = session;

  const { data, error } = await client.rpc("cancel_own_booking", { p_booking_id: bookingId });
  if (error) {
    return NextResponse.json(
      { error: "Could not cancel the booking.", detail: error.message },
      { status: 500 },
    );
  }

  const outcome = data as Outcome;
  if (outcome !== "cancelled") {
    return NextResponse.json(
      { error: "The booking was not cancelled.", outcome, cutoffMinutes: tenant.cancellation_cutoff_minutes },
      { status: STATUS_FOR[outcome] ?? 500 },
    );
  }

  // Committed. Everything below is a courtesy message and never changes the answer.
  const { data: booking } = await client
    .from("bookings")
    .select("id, starts_at, price_twd, services(name), staff(name)")
    .eq("id", bookingId)
    .maybeSingle();

  let notification: "sent" | "failed" | "skipped" = "skipped";
  const channelAccessToken = serverEnv.lineMessagingChannelAccessToken();
  if (booking && channelAccessToken) {
    type Joined = {
      id: string; starts_at: string; price_twd: number;
      services: { name: string } | null; staff: { name: string } | null;
    };
    const row = booking as unknown as Joined;
    const pushed = await pushToLineUser({
      channelAccessToken,
      to: identity.lineUserId,
      messages: [
        buildBookingCancelledMessage({
          tenantName: tenant.name,
          brandPrimary: tenant.brand?.primary ?? "#222222",
          serviceName: row.services?.name ?? "",
          staffName: row.staff?.name ?? t("booking.staff.any"),
          startsAt: new Date(row.starts_at),
          priceTwd: row.price_twd,
          bookingId: row.id,
          bookAgainUrl: liffPageUrl(tenant.liff_id, "/"),
        }),
      ],
    });
    notification = pushed.status === "sent" ? "sent" : "failed";
  }

  return NextResponse.json(
    { outcome, bookingId, notification },
    { headers: { "cache-control": "no-store" } },
  );
}
