import "server-only";

/**
 * Pushes messages to one LINE user via the Messaging API.
 *
 * A push is a side effect of a booking, never a condition of it. Callers must
 * treat every failure here as "booking succeeded, notification did not", and
 * this module never throws for a LINE-side failure — it reports it.
 *
 * Bounded by a timeout so a slow LINE API cannot hold the booking response
 * hostage; Vercel's function limit is the hard ceiling and this stays well
 * inside it.
 */

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const PUSH_TIMEOUT_MS = 5_000;

export type PushOutcome =
  | { status: "sent" }
  | { status: "failed"; httpStatus?: number; detail: string };

export async function pushToLineUser(options: {
  channelAccessToken: string;
  /** The verified `sub`. Provider-scoped, so it must be the same Provider's channel. */
  to: string;
  messages: unknown[];
}): Promise<PushOutcome> {
  const { channelAccessToken, to, messages } = options;

  try {
    const response = await fetch(LINE_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({ to, messages }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      cache: "no-store",
    });

    if (response.ok) return { status: "sent" };

    // LINE's error body is the most useful thing to surface: it distinguishes
    // "not a friend" from "bad token" from "malformed Flex".
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    return { status: "failed", httpStatus: response.status, detail };
  } catch (error) {
    return {
      status: "failed",
      detail:
        error instanceof Error && error.name === "TimeoutError"
          ? `LINE did not respond within ${PUSH_TIMEOUT_MS}ms`
          : String(error),
    };
  }
}
