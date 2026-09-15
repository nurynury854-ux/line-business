import { NextResponse } from "next/server";
import { createRequestScopedClient } from "@/lib/supabase/client";
import { mintReminderJobToken } from "@/lib/supabase/tokens";
import { buildBookingReminderMessage } from "@/lib/line/booking-reminder";
import { pushToLineUser } from "@/lib/line/push";
import { serverEnv } from "@/lib/env";

/**
 * GET /api/cron/reminders — pushes day-before reminders. Scheduled daily at
 * 19:00 Asia/Taipei; see vercel.json.
 *
 * MUST NOT be publicly triggerable. It sends real messages to real customers, so
 * an open endpoint is a spam cannon pointed at a salon's clientele. Vercel sends
 * `Authorization: Bearer $CRON_SECRET` on scheduled invocations; this refuses to
 * run without a matching secret, and refuses to run if no secret is configured
 * at all rather than defaulting to open.
 *
 * Idempotent by construction: it only selects bookings whose reminder_sent_at is
 * null, and stamps each one only after LINE has accepted the push. A retry, a
 * redeploy, or a double-fired schedule re-sends nothing. A push that fails is
 * deliberately left unstamped so tomorrow's run can try again — the message is
 * only useful before the appointment, but a missing reminder beats a duplicate.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Batches are small, but a slow LINE API should not truncate the run. */
export const maxDuration = 60;

type DueRow = {
  booking_id: string;
  tenant_name: string;
  tenant_brand: { primary?: string } | null;
  line_user_id: string;
  service_name: string;
  staff_name: string;
  starts_at: string;
  duration_minutes: number;
  price_twd: number;
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured; refusing to run." },
      { status: 503 },
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const channelAccessToken = serverEnv.lineMessagingChannelAccessToken();
  if (!channelAccessToken) {
    return NextResponse.json(
      { ok: false, reason: "LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not set", sent: 0 },
      { status: 503 },
    );
  }

  const client = createRequestScopedClient(await mintReminderJobToken());

  const { data, error } = await client.rpc("reminders_due");
  if (error) {
    return NextResponse.json(
      { ok: false, error: "Could not load due reminders.", detail: error.message },
      { status: 500 },
    );
  }

  const due = (data ?? []) as DueRow[];
  let sent = 0;
  const failures: { bookingId: string; detail: string }[] = [];

  for (const row of due) {
    const outcome = await pushToLineUser({
      channelAccessToken,
      to: row.line_user_id,
      messages: [
        buildBookingReminderMessage({
          tenantName: row.tenant_name,
          brandPrimary: row.tenant_brand?.primary ?? "#222222",
          serviceName: row.service_name,
          staffName: row.staff_name,
          startsAt: new Date(row.starts_at),
          durationMinutes: row.duration_minutes,
          priceTwd: row.price_twd,
        }),
      ],
    });

    if (outcome.status !== "sent") {
      // Left unstamped on purpose so a later run can retry. The commonest cause
      // is the customer having removed the salon's official account as a friend.
      failures.push({
        bookingId: row.booking_id,
        detail: `${outcome.httpStatus ?? "?"} ${outcome.detail}`.slice(0, 200),
      });
      continue;
    }

    const { data: stamped } = await client.rpc("reminders_mark_sent", {
      p_booking_id: row.booking_id,
    });

    // Stamping is what prevents a duplicate, so a failure here matters more than
    // the send did: surface it rather than counting a silent success.
    if (stamped === false) {
      failures.push({ bookingId: row.booking_id, detail: "sent but could not be marked" });
      continue;
    }
    sent += 1;
  }

  return NextResponse.json(
    { ok: failures.length === 0, due: due.length, sent, failures },
    { headers: { "cache-control": "no-store" } },
  );
}
