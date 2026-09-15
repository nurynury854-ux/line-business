"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * LIFF diagnostics screen.
 *
 * A developer tool, not customer UI: it surfaces LIFF results and failures on a
 * physical phone, where there is no console.
 *
 * Two deliberate deviations from CLAUDE.md, scoped to this screen:
 *  - §7 (i18n): labels are untranslated English on purpose. Localise or delete
 *    this screen before anything customer-facing ships.
 *  - §3 (identity): everything shown here is DISPLAY ONLY. Nothing is wired to
 *    the database, and the ID token is decoded WITHOUT verification purely to
 *    show its claims — the server verifies it properly against LINE.
 *
 * Each capability is probed INDEPENDENTLY. A missing scope must degrade to
 * "unavailable" for that one row, never fail the whole page: the screen exists
 * to explain failures, so it has to survive them.
 */

type Probe<T> =
  | { state: "ok"; value: T }
  | { state: "unavailable"; detail: string };

type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type IdTokenInfo = {
  length: number;
  sub?: string;
  aud?: string;
  expiresInSeconds?: number;
};

type Report = {
  liffId: string;
  isInClient: boolean;
  isLoggedIn: boolean;
  os: string;
  language: string;
  sdkVersion: string;
  idToken: Probe<IdTokenInfo>;
  profile: Probe<LiffProfile>;
};

type Phase =
  | { status: "loading" }
  | { status: "redirecting" }
  | { status: "ready"; report: Report }
  | { status: "error"; detail: string };

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const parts: string[] = [];
    const code = (error as { code?: unknown }).code;
    if (code !== undefined) parts.push(`code: ${String(code)}`);
    parts.push(`${error.name}: ${error.message}`);
    if (error.stack) parts.push(error.stack);
    return parts.join("\n\n");
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      /* unserialisable */
    }
  }
  return String(error);
}

/**
 * Reads claims for DISPLAY. This is not verification and must never be treated
 * as such — the server checks the signature, audience and issuer against LINE.
 */
function peekIdTokenClaims(token: string): Omit<IdTokenInfo, "length"> {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { sub?: string; aud?: string; exp?: number };
    return {
      sub: payload.sub,
      aud: payload.aud,
      expiresInSeconds: payload.exp
        ? Math.round(payload.exp - Date.now() / 1000)
        : undefined,
    };
  } catch {
    return {};
  }
}

export default function LiffDiagnostics() {
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const hasStarted = useRef(false);

  const initialise = useCallback(async () => {
    try {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      if (!liffId) {
        throw new Error(
          "NEXT_PUBLIC_LIFF_ID is not set. Add it in Vercel as type Config, " +
            "then redeploy — NEXT_PUBLIC_* values are inlined at build time, " +
            "so saving the variable alone does not update the running site.",
        );
      }

      const liff = (await import("@line/liff")).default;
      await liff.init({ liffId });

      if (!liff.isLoggedIn()) {
        setPhase({ status: "redirecting" });
        liff.login({ redirectUri: window.location.href });
        return;
      }

      // Probed separately: openid grants the ID token, profile grants the
      // profile. Having one and not the other is a normal configuration.
      let idToken: Probe<IdTokenInfo>;
      try {
        const raw = liff.getIDToken();
        idToken = raw
          ? { state: "ok", value: { length: raw.length, ...peekIdTokenClaims(raw) } }
          : {
              state: "unavailable",
              detail:
                "getIDToken() returned null. The LIFF app almost certainly " +
                "lacks the 'openid' scope — without it the server cannot " +
                "verify identity and no booking can be written.",
            };
      } catch (error) {
        idToken = { state: "unavailable", detail: describeError(error) };
      }

      let profile: Probe<LiffProfile>;
      try {
        profile = { state: "ok", value: await liff.getProfile() };
      } catch (error) {
        profile = {
          state: "unavailable",
          detail:
            "getProfile() failed, which is EXPECTED when the 'profile' scope " +
            "is not enabled. This does not block booking: the flow never calls " +
            "it, and the server takes identity from the verified ID token.\n\n" +
            describeError(error),
        };
      }

      setPhase({
        status: "ready",
        report: {
          liffId,
          isInClient: liff.isInClient(),
          isLoggedIn: liff.isLoggedIn(),
          os: String(liff.getOS() ?? "unknown"),
          language: liff.getLanguage(),
          sdkVersion: liff.getVersion(),
          idToken,
          profile,
        },
      });
    } catch (error) {
      setPhase({ status: "error", detail: describeError(error) });
    }
  }, []);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    void initialise();
  }, [initialise]);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <h1 className="text-lg font-semibold">LIFF diagnostics</h1>

      {phase.status === "loading" && <Note>Initialising LIFF…</Note>}
      {phase.status === "redirecting" && <Note>Not logged in. Redirecting to LINE…</Note>}
      {phase.status === "error" && <ErrorPanel detail={phase.detail} />}

      {phase.status === "ready" && (
        <div className="mt-5 flex flex-col gap-6">
          <Verdict report={phase.report} />

          <section>
            <h2 className="mb-1 text-sm font-semibold">Identity</h2>
            <dl>
              {phase.report.idToken.state === "ok" ? (
                <>
                  <Row label="getIDToken()" value={`present (${phase.report.idToken.value.length} chars)`} good />
                  <Row label="  token sub" value={phase.report.idToken.value.sub ?? "(none)"} />
                  <Row label="  token aud (channel id)" value={phase.report.idToken.value.aud ?? "(none)"} />
                  <Row label="  expires in" value={`${phase.report.idToken.value.expiresInSeconds ?? "?"}s`} />
                </>
              ) : (
                <RowBlock label="getIDToken()" detail={phase.report.idToken.detail} bad />
              )}
            </dl>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold">Profile</h2>
            {phase.report.profile.state === "ok" ? (
              <dl>
                <Row label="displayName" value={phase.report.profile.value.displayName} />
                <Row label="userId" value={phase.report.profile.value.userId} />
                <Row label="pictureUrl" value={phase.report.profile.value.pictureUrl ?? "(none)"} />
              </dl>
            ) : (
              <RowBlock label="getProfile()" detail={phase.report.profile.detail} />
            )}
          </section>

          <section>
            <h2 className="mb-1 text-sm font-semibold">Environment</h2>
            <dl>
              <Row label="liffId" value={phase.report.liffId} />
              <Row label="isInClient()" value={String(phase.report.isInClient)} />
              <Row label="isLoggedIn()" value={String(phase.report.isLoggedIn)} />
              <Row label="getOS()" value={phase.report.os} />
              <Row label="getLanguage()" value={phase.report.language} />
              <Row label="getVersion()" value={phase.report.sdkVersion} />
            </dl>
          </section>
        </div>
      )}
    </main>
  );
}

/** The one line worth reading first: can this device book or not? */
function Verdict({ report }: { report: Report }) {
  const canBook = report.idToken.state === "ok";
  return (
    <section
      className={`rounded-xl border p-3 text-sm leading-relaxed ${
        canBook
          ? "border-green-200 bg-green-50 text-green-900"
          : "border-red-200 bg-red-50 text-red-900"
      }`}
    >
      <strong>{canBook ? "Booking should work." : "Booking will NOT work."}</strong>{" "}
      {canBook
        ? "LIFF initialised and an ID token is available, which is all the booking flow needs."
        : "LIFF initialised but no ID token is available, so the server cannot establish identity."}
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 text-sm text-black/60" role="status" aria-live="polite">
      {children}
    </p>
  );
}

function ErrorPanel({ detail }: { detail: string }) {
  return (
    <section className="mt-5" role="alert">
      <h2 className="mb-2 text-sm font-semibold text-red-700">LIFF init failed</h2>
      <pre className="select-all whitespace-pre-wrap break-words rounded-xl bg-red-50 p-3 font-mono text-xs leading-relaxed text-red-900">
        {detail}
      </pre>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-4 min-h-11 w-full rounded-xl bg-black px-5 text-base font-medium text-white active:opacity-80"
      >
        Retry
      </button>
    </section>
  );
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="border-t border-black/10 py-3">
      <dt className="text-xs text-black/50">{label}</dt>
      <dd className={`mt-0.5 break-all font-mono text-sm ${good ? "text-green-700" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function RowBlock({ label, detail, bad }: { label: string; detail: string; bad?: boolean }) {
  return (
    <div className="border-t border-black/10 py-3">
      <dt className={`text-xs ${bad ? "text-red-700" : "text-black/50"}`}>
        {label} — unavailable
      </dt>
      <dd className="mt-1">
        <pre
          className={`select-all whitespace-pre-wrap break-words rounded-lg p-2.5 font-mono text-xs leading-relaxed ${
            bad ? "bg-red-50 text-red-900" : "bg-black/[0.04] text-black/70"
          }`}
        >
          {detail}
        </pre>
      </dd>
    </div>
  );
}
