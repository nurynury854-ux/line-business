/**
 * Client-side helper for obtaining an ID token that LINE will still accept.
 *
 * liff.getIDToken() returns the token minted at LOGIN, not a fresh one per call,
 * and LINE ID tokens expire. Any LIFF page opened in a session older than that
 * lifetime hands over a stale token, and the server's verification fails with a
 * 401 that looks like a permissions problem rather than an expiry one.
 *
 * That failure is not rare and not the user's fault: a salon owner opening their
 * schedule each morning would hit it daily. So expiry is checked BEFORE the
 * request and a re-login is triggered automatically, rather than surfacing an
 * error and asking someone to tap a button.
 *
 * The expiry read here decodes the token WITHOUT verifying it. That is safe
 * because it is used only to decide whether to re-login — never to establish
 * identity. The server verifies the token against LINE for real (CLAUDE.md §3).
 */

type LiffLike = {
  isLoggedIn: () => boolean;
  getIDToken: () => string | null;
  login: (options?: { redirectUri?: string }) => void;
};

export type IdTokenResult =
  | { status: "ok"; idToken: string }
  /** A login was triggered; the page is navigating away. Stop work. */
  | { status: "redirecting" }
  | { status: "unavailable"; reason: string };

/** Seconds of remaining life below which we refresh rather than risk a 401. */
const MIN_REMAINING_SECONDS = 60;

export function readIdTokenExpiry(token: string): number | null {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const payload = JSON.parse(
      atob(segment.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export function acquireFreshIdToken(
  liff: LiffLike,
  redirectUri: string,
): IdTokenResult {
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri });
    return { status: "redirecting" };
  }

  const idToken = liff.getIDToken();
  if (!idToken) {
    // Nothing a re-login fixes: the LIFF app is missing the openid scope.
    return {
      status: "unavailable",
      reason:
        "getIDToken() returned null — the LIFF app is missing the 'openid' scope.",
    };
  }

  const expiresAt = readIdTokenExpiry(idToken);
  // A token whose expiry cannot be read is passed through: the server is the
  // authority, and refusing here would break on any future token format change.
  if (expiresAt === null) return { status: "ok", idToken };

  if (expiresAt - Date.now() / 1000 < MIN_REMAINING_SECONDS) {
    liff.login({ redirectUri });
    return { status: "redirecting" };
  }

  return { status: "ok", idToken };
}
