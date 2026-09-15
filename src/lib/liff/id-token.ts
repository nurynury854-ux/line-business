/**
 * Client-side helper for obtaining an ID token that LINE will still accept.
 *
 * liff.getIDToken() returns the token minted at LOGIN, not a fresh one per call,
 * and LINE ID tokens expire. Any LIFF page opened in a session older than that
 * lifetime hands over a stale token, and the server's verification fails with a
 * 401 that reads like a permissions problem rather than an expiry one. A salon
 * owner opening their schedule each morning would hit that daily, so expiry is
 * checked BEFORE the request and a re-login triggered automatically.
 *
 * THE LOOP GUARD IS NOT OPTIONAL. "Token looks stale, so log in again" is an
 * infinite redirect the moment login does not actually yield a usable token —
 * which is exactly what happens in an external browser when storage is
 * unavailable. So a login is attempted AT MOST ONCE per browsing session; if the
 * token is still unusable after coming back, the caller gets a reportable error
 * instead of another redirect. Never remove this without replacing it.
 *
 * The expiry read here decodes the token WITHOUT verifying it. That is safe
 * because it only decides whether to re-login — never to establish identity. The
 * server verifies against LINE for real (CLAUDE.md §3).
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

const LOGIN_ATTEMPT_KEY = "liff:login-attempted";

// sessionStorage can throw in private modes and is exactly what is missing in
// the browsers this guard exists for, so every access is defensive. Failing to
// read the flag must never itself cause a loop: an unreadable store is treated
// as "already attempted", which stops rather than spins.
function hasAttemptedLogin(): boolean {
  try {
    return sessionStorage.getItem(LOGIN_ATTEMPT_KEY) === "1";
  } catch {
    return true;
  }
}

function markLoginAttempted(): void {
  try {
    sessionStorage.setItem(LOGIN_ATTEMPT_KEY, "1");
  } catch {
    /* storage blocked — the read path already fails closed */
  }
}

function clearLoginAttempted(): void {
  try {
    sessionStorage.removeItem(LOGIN_ATTEMPT_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Where LINE should send the user back to.
 *
 * Deliberately drops query and hash: returning from login leaves LIFF's own
 * callback parameters (code, state, liffClientId, liffRedirectUri) in the URL,
 * and feeding those back as the next redirectUri makes the target grow on every
 * round trip.
 */
function cleanRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

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

const LOOPED_REASON =
  "Signed in, but LINE still did not provide a usable ID token. This normally " +
  "means the browser is blocking the storage LIFF keeps its session in — " +
  "common in private windows, Safari, and browsers with third-party cookies " +
  "disabled. Opening this page inside the LINE app works instead.";

export function acquireFreshIdToken(liff: LiffLike): IdTokenResult {
  const attemptLogin = (reason: string): IdTokenResult => {
    if (hasAttemptedLogin()) {
      // We already came back from a login and are no better off. Stop.
      return { status: "unavailable", reason: `${LOOPED_REASON}\n\n(${reason})` };
    }
    markLoginAttempted();
    liff.login({ redirectUri: cleanRedirectUri() });
    return { status: "redirecting" };
  };

  if (!liff.isLoggedIn()) {
    return attemptLogin("isLoggedIn() was false after init");
  }

  const idToken = liff.getIDToken();
  if (!idToken) {
    // A re-login cannot fix a missing scope, so do not spend the one attempt.
    return {
      status: "unavailable",
      reason:
        "getIDToken() returned null — the LIFF app is missing the 'openid' scope.",
    };
  }

  const expiresAt = readIdTokenExpiry(idToken);
  // A token whose expiry cannot be read is passed through: the server is the
  // authority, and refusing here would break on any future format change.
  if (expiresAt !== null && expiresAt - Date.now() / 1000 < MIN_REMAINING_SECONDS) {
    return attemptLogin(`token expired ${Math.round(Date.now() / 1000 - expiresAt)}s ago`);
  }

  clearLoginAttempted();
  return { status: "ok", idToken };
}
