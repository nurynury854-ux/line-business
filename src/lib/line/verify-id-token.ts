import "server-only";

/**
 * SERVER ONLY — enforced by the `server-only` import above: importing this from
 * a client component fails the build rather than shipping the trust boundary,
 * and any secret it reaches, to the browser.
 *
 * Verifies a LIFF ID token against LINE, server-side.
 *
 * This is the trust boundary (CLAUDE.md §3). The browser sends a TOKEN, never
 * an identity; the only acceptable source of a LINE user id is the `sub` of a
 * token LINE itself has just validated.
 *
 * Uses LINE's verify endpoint rather than local JWKS verification: LINE checks
 * signature, issuer, audience and expiry in one call, and no channel secret is
 * needed. The cost is a round trip per request, which is the trade CLAUDE.md §3
 * already accepts by verifying on every request rather than holding a session.
 */

const LINE_VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";
const LINE_EXPECTED_ISSUER = "https://access.line.me";

export class LineTokenVerificationError extends Error {
  readonly lineError?: string;
  readonly lineErrorDescription?: string;

  constructor(
    message: string,
    options?: { lineError?: string; lineErrorDescription?: string },
  ) {
    super(message);
    this.name = "LineTokenVerificationError";
    this.lineError = options?.lineError;
    this.lineErrorDescription = options?.lineErrorDescription;
  }
}

export type VerifiedLineIdentity = {
  /** The `sub` of the verified token. Trustworthy; nothing else here is. */
  lineUserId: string;
  /** Profile fields, present only if the token carried them. DISPLAY ONLY. */
  displayName?: string;
  pictureUrl?: string;
};

type LineVerifyResponse = {
  iss?: string;
  sub?: string;
  aud?: string;
  exp?: number;
  name?: string;
  picture?: string;
  error?: string;
  error_description?: string;
};

/**
 * @param idToken          raw ID token from liff.getIDToken()
 * @param expectedChannelId  the resolved tenant's line_login_channel_id — this
 *   is what stops one salon's token being replayed against another, so it must
 *   come from the tenant row, never from configuration.
 */
export async function verifyLineIdToken(
  idToken: string,
  expectedChannelId: string,
): Promise<VerifiedLineIdentity> {
  if (!idToken) {
    throw new LineTokenVerificationError("No ID token supplied.");
  }

  let response: Response;
  try {
    response = await fetch(LINE_VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id_token: idToken,
        client_id: expectedChannelId,
      }),
      cache: "no-store",
    });
  } catch (cause) {
    throw new LineTokenVerificationError(
      `Could not reach LINE's verify endpoint: ${String(cause)}`,
    );
  }

  let payload: LineVerifyResponse;
  try {
    payload = (await response.json()) as LineVerifyResponse;
  } catch {
    throw new LineTokenVerificationError(
      `LINE returned a non-JSON response (HTTP ${response.status}).`,
    );
  }

  if (!response.ok) {
    throw new LineTokenVerificationError(
      `LINE rejected the ID token (HTTP ${response.status}).`,
      { lineError: payload.error, lineErrorDescription: payload.error_description },
    );
  }

  // LINE has already checked these. Re-asserting them costs nothing and means a
  // change in LINE's behaviour, or a misrouted response, cannot silently admit
  // a token meant for a different channel.
  if (payload.aud !== expectedChannelId) {
    throw new LineTokenVerificationError(
      "Token audience does not match this tenant's LINE Login channel.",
    );
  }

  if (payload.iss !== LINE_EXPECTED_ISSUER) {
    throw new LineTokenVerificationError(
      `Unexpected token issuer: ${String(payload.iss)}`,
    );
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new LineTokenVerificationError(
      "Verified token carried no subject, so there is no user id to trust.",
    );
  }

  return {
    lineUserId: payload.sub,
    displayName: payload.name,
    pictureUrl: payload.picture,
  };
}
