"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * LIFF diagnostics screen.
 *
 * This is a developer tool, not customer UI. It exists to surface LIFF init
 * results and failures on a physical phone, where there is no console.
 *
 * Two deliberate deviations from CLAUDE.md, both scoped to this screen:
 *  - §7 (i18n): labels are untranslated English on purpose. This screen should
 *    be localised or deleted before anything customer-facing ships.
 *  - §3 (identity): the userId rendered here is DISPLAY ONLY. Client-reported
 *    identity must never authorise anything — the server verifies the ID token
 *    itself. Nothing here is wired to the database.
 */

type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
};

type LiffEnvironment = {
  isInClient: boolean;
  os: string;
  language: string;
  sdkVersion: string;
};

type Phase =
  | { status: "loading" }
  | { status: "redirecting" }
  | { status: "ready"; profile: LiffProfile; environment: LiffEnvironment }
  | { status: "error"; detail: string };

/**
 * Renders an unknown thrown value as readable text without losing anything.
 * LIFF rejects with objects carrying a `code` (e.g. INVALID_ARGUMENT,
 * UNAUTHORIZED), which is usually the most diagnostic part, so it goes first.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const sections: string[] = [];
    const code = (error as { code?: unknown }).code;
    if (code !== undefined) sections.push(`code: ${String(code)}`);
    sections.push(`${error.name}: ${error.message}`);
    if (error.stack) sections.push(error.stack);
    return sections.join("\n\n");
  }

  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      // Circular or otherwise unserialisable — fall through to String().
    }
  }

  return String(error);
}

export default function LiffDiagnostics() {
  const [phase, setPhase] = useState<Phase>({ status: "loading" });

  // React runs effects twice in development. liff.init() is not idempotent,
  // so the second call must not happen.
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

      // Imported here rather than at module scope: the SDK touches `window` on
      // load and would break the server render.
      const liff = (await import("@line/liff")).default;

      await liff.init({ liffId });

      if (!liff.isLoggedIn()) {
        // Full-page redirect to LINE. Nothing after this runs.
        setPhase({ status: "redirecting" });
        liff.login({ redirectUri: window.location.href });
        return;
      }

      const profile = await liff.getProfile();

      setPhase({
        status: "ready",
        profile,
        environment: {
          isInClient: liff.isInClient(),
          os: String(liff.getOS() ?? "unknown"),
          language: liff.getLanguage(),
          sdkVersion: liff.getVersion(),
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

      {phase.status === "loading" && <StatusNote>Initialising LIFF…</StatusNote>}

      {phase.status === "redirecting" && (
        <StatusNote>Not logged in. Redirecting to LINE…</StatusNote>
      )}

      {phase.status === "error" && <ErrorPanel detail={phase.detail} />}

      {phase.status === "ready" && (
        <div className="mt-5 flex flex-col gap-6">
          <ProfileCard profile={phase.profile} />
          <section>
            <h2 className="mb-1 text-sm font-semibold">Environment</h2>
            <dl>
              <Row
                label="isInClient()"
                value={String(phase.environment.isInClient)}
              />
              <Row label="getOS()" value={phase.environment.os} />
              <Row label="getLanguage()" value={phase.environment.language} />
              <Row label="getVersion()" value={phase.environment.sdkVersion} />
            </dl>
          </section>
        </div>
      )}
    </main>
  );
}

function StatusNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-5 text-sm text-black/60"
      role="status"
      aria-live="polite"
    >
      {children}
    </p>
  );
}

function ErrorPanel({ detail }: { detail: string }) {
  return (
    <section className="mt-5" role="alert">
      <h2 className="mb-2 text-sm font-semibold text-red-700">
        LIFF init failed
      </h2>
      {/* select-all so one tap grabs the whole message on a phone; break-words
          so long stack frames wrap instead of forcing a horizontal scroll. */}
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

function ProfileCard({ profile }: { profile: LiffProfile }) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">Profile</h2>
      <div className="flex items-center gap-3 py-3">
        {profile.pictureUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- next/image
             would need images.remotePatterns for LINE's CDN, and a wrong guess
             at that host would break this screen. A plain img keeps the
             diagnostic free of config that can itself fail. */
          <img
            src={profile.pictureUrl}
            alt=""
            width={64}
            height={64}
            className="size-16 shrink-0 rounded-full bg-black/5 object-cover"
          />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-black/5 text-[10px] text-black/40">
            none
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-base font-medium">
            {profile.displayName}
          </p>
          <p className="text-xs text-black/50">displayName</p>
        </div>
      </div>
      <dl>
        <Row label="userId" value={profile.userId} />
        <Row label="pictureUrl" value={profile.pictureUrl ?? "(none)"} />
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-black/10 py-3">
      <dt className="text-xs text-black/50">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-sm">{value}</dd>
    </div>
  );
}
