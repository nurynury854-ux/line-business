"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { formatPriceTwd } from "@/i18n/format";
import { TAIPEI_TIME_ZONE } from "@/lib/time/taipei";

type Booking = {
  id: string;
  startsAt: string;
  durationMinutes: number;
  priceTwd: number;
  serviceName: string | null;
  staffName: string | null;
  customerName: string | null;
};

type Range = "today" | "week";

type State =
  | { status: "loading" }
  | { status: "redirecting" }
  | { status: "ready"; bookings: Booking[] }
  | { status: "denied" }
  /** The ID token LIFF handed us was rejected — almost always an expired one. */
  | { status: "expired"; detail: string }
  | { status: "error"; message: string; detail?: string };

let liffPromise: Promise<typeof import("@line/liff").default> | null = null;
function loadLiff(liffId: string) {
  if (!liffPromise) {
    liffPromise = (async () => {
      const liff = (await import("@line/liff")).default;
      await liff.init({ liffId });
      return liff;
    })().catch((error) => {
      liffPromise = null;
      throw error;
    });
  }
  return liffPromise;
}

/**
 * Instants come back as UTC and are rendered in Asia/Taipei here, at the display
 * boundary and nowhere else (CLAUDE.md §4).
 */
function taipeiTime(iso: string) {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function taipeiDayLabel(iso: string) {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(iso));
}

export default function AdminSchedule({
  tenantName,
  brandPrimary,
  tenantSlug,
  liffId,
}: {
  tenantName: string;
  brandPrimary: string;
  tenantSlug: string;
  liffId?: string;
}) {
  const [range, setRange] = useState<Range>("today");
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(
    async (which: Range) => {
      setState({ status: "loading" });
      if (!liffId) {
        setState({ status: "error", message: t("admin.error") });
        return;
      }
      try {
        const liff = await loadLiff(liffId);
        if (!liff.isLoggedIn()) {
          setState({ status: "redirecting" });
          liff.login({ redirectUri: window.location.href });
          return;
        }
        const idToken = liff.getIDToken();
        if (!idToken) {
          setState({ status: "error", message: t("admin.needLogin") });
          return;
        }

        const response = await fetch("/api/admin/bookings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantSlug, idToken, range: which }),
        });

        if (response.status === 403) {
          setState({ status: "denied" });
          return;
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
            detail?: unknown;
          };
          const detail = `HTTP ${response.status} — ${payload.error ?? "(no message)"}${
            payload.detail ? `\n${typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail)}` : ""
          }`;

          // liff.getIDToken() returns the token minted at LOGIN, and it expires.
          // Opening this page in an older LIFF session hands over a stale token
          // that LINE then rejects — which is a re-login, not a failure.
          if (response.status === 401) {
            setState({ status: "expired", detail });
            return;
          }

          setState({ status: "error", message: t("admin.error"), detail });
          return;
        }

        const payload = (await response.json()) as { bookings: Booking[] };
        setState({ status: "ready", bookings: payload.bookings });
      } catch {
        setState({ status: "error", message: t("admin.error") });
      }
    },
    [liffId, tenantSlug],
  );

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const brandStyle = { "--brand-primary": brandPrimary } as CSSProperties;

  const revenue =
    state.status === "ready"
      ? state.bookings.reduce((sum, booking) => sum + booking.priceTwd, 0)
      : 0;

  return (
    <div style={brandStyle} className="min-h-dvh bg-black/[0.02]">
      <header className="px-4 pt-5 pb-3">
        <p className="truncate text-base font-semibold">{tenantName}</p>
        <p className="text-xs text-black/55">{t("admin.title")}</p>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-10">
        {/* Two big targets rather than a dropdown: one-handed, 44px+ each. */}
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(["today", "week"] as const).map((option) => {
            const active = range === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                aria-pressed={active}
                className="min-h-11 rounded-xl border-2 text-sm font-medium active:opacity-80"
                style={{
                  borderColor: active ? "var(--brand-primary)" : "rgba(0,0,0,0.12)",
                  backgroundColor: active ? "var(--brand-primary)" : "white",
                  color: active ? "#ffffff" : undefined,
                }}
              >
                {t(option === "today" ? "admin.range.today" : "admin.range.week")}
              </button>
            );
          })}
        </div>

        {state.status === "loading" && (
          <p className="py-8 text-center text-sm text-black/50">{t("admin.loading")}</p>
        )}
        {state.status === "redirecting" && (
          <p className="py-8 text-center text-sm text-black/50">{t("admin.loading")}</p>
        )}

        {state.status === "denied" && (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            {t("admin.notAdmin")}
          </p>
        )}

        {state.status === "expired" && (
          <div>
            <p role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-relaxed text-amber-900">
              {t("admin.expired")}
            </p>
            <button
              type="button"
              onClick={() => {
                if (!liffId) return;
                void loadLiff(liffId).then((liff) =>
                  liff.login({ redirectUri: window.location.href }),
                );
              }}
              className="min-h-14 w-full rounded-xl text-base font-semibold text-white active:opacity-80"
              style={{ backgroundColor: "var(--brand-primary)" }}
            >
              {t("admin.relogin")}
            </button>
            <pre className="mt-3 select-all whitespace-pre-wrap break-words rounded-lg bg-black/[0.04] p-2.5 font-mono text-[11px] leading-relaxed text-black/60">
              {state.detail}
            </pre>
          </div>
        )}

        {state.status === "error" && (
          <div>
            <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900">
              {state.message}
            </p>
            {state.detail && (
              <pre className="mb-3 select-all whitespace-pre-wrap break-words rounded-lg bg-red-50 p-2.5 font-mono text-[11px] leading-relaxed text-red-900">
                {state.detail}
              </pre>
            )}
            <button
              type="button"
              onClick={() => void load(range)}
              className="min-h-11 w-full rounded-xl border-2 border-black/15 text-base font-medium active:opacity-80"
            >
              {t("admin.retry")}
            </button>
          </div>
        )}

        {state.status === "ready" && (
          <>
            <div className="mb-3 flex items-baseline justify-between text-xs text-black/55">
              <span>{t("admin.count", { count: state.bookings.length })}</span>
              {state.bookings.length > 0 && (
                <span>{t("admin.revenue", { amount: formatPriceTwd(revenue) })}</span>
              )}
            </div>

            {state.bookings.length === 0 ? (
              <p className="py-8 text-center text-sm text-black/50">
                {t(range === "today" ? "admin.empty.today" : "admin.empty.week")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {state.bookings.map((booking) => (
                  <li
                    key={booking.id}
                    className="rounded-xl border border-black/10 bg-white p-3"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-base font-semibold tabular-nums">
                        {taipeiTime(booking.startsAt)}
                      </span>
                      {range === "week" && (
                        <span className="text-xs text-black/50">
                          {taipeiDayLabel(booking.startsAt)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium">
                      {booking.customerName ?? (
                        <span className="text-black/40">{t("admin.customerUnknown")}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-black/55">
                      {[booking.serviceName, booking.staffName].filter(Boolean).join("・")}
                      {" ・ "}
                      {formatPriceTwd(booking.priceTwd)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
