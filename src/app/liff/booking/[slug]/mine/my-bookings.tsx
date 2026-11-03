"use client";

import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { formatInstantShort, formatMinutesAsDuration, formatPriceTwd } from "@/i18n/format";
import { TAIPEI_TIME_ZONE } from "@/lib/time/taipei";
import { acquireFreshIdToken } from "@/lib/liff/id-token";
import { loadLiff } from "@/lib/liff/load";
import { bookingHomePath } from "@/lib/tenants/slug";

type Status = "confirmed" | "cancelled" | "completed" | "no_show";

type Booking = {
  id: string;
  startsAt: string;
  status: Status;
  durationMinutes: number;
  priceTwd: number;
  serviceName: string | null;
  staffName: string | null;
  cancelDeadline: string;
  canCancel: boolean;
};

type Loaded = { upcoming: Booking[]; past: Booking[]; cutoffMinutes: number };

type State =
  | { status: "loading" }
  | { status: "redirecting" }
  | { status: "ready"; data: Loaded }
  | { status: "expired"; detail: string }
  | { status: "error"; message: string; detail?: string };

type CancelState =
  | { status: "idle" }
  /** The bottom sheet is open for this booking. */
  | { status: "confirming"; booking: Booking }
  | { status: "submitting"; booking: Booking }
  | { status: "done"; booking: Booking }
  | { status: "refused"; booking: Booking; message: string }
  | { status: "error"; booking: Booking };

/** Instants are UTC in the API and become Asia/Taipei only here (CLAUDE.md §4). */
function taipeiTime(iso: string) {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function taipeiDay(iso: string) {
  return new Intl.DateTimeFormat("zh-Hant-TW", {
    timeZone: TAIPEI_TIME_ZONE,
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(iso));
}

const STATUS_KEY: Record<Status, Parameters<typeof t>[0]> = {
  confirmed: "mine.status.confirmed",
  cancelled: "mine.status.cancelled",
  completed: "mine.status.completed",
  no_show: "mine.status.no_show",
};

export default function MyBookings({
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
  const [state, setState] = useState<State>({ status: "loading" });
  const [cancel, setCancel] = useState<CancelState>({ status: "idle" });

  /**
   * Fetches a usable ID token, logging in if needed. Returns null when the page
   * is navigating away or cannot proceed — the state has been set already.
   */
  const getToken = useCallback(async (): Promise<string | null> => {
    if (!liffId) {
      setState({ status: "error", message: t("mine.error") });
      return null;
    }
    const liff = await loadLiff(liffId);
    const token = acquireFreshIdToken(liff);
    if (token.status === "redirecting") {
      setState({ status: "redirecting" });
      return null;
    }
    if (token.status === "unavailable") {
      const isScopeProblem = token.reason.includes("openid");
      setState({
        status: "error",
        message: isScopeProblem ? t("mine.needLogin") : t("mine.openInLine"),
        detail: token.reason,
      });
      return null;
    }
    return token.idToken;
  }, [liffId]);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const idToken = await getToken();
      if (!idToken) return;

      const response = await fetch("/api/bookings/mine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantSlug, idToken }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string; detail?: unknown };
        const detail = `HTTP ${response.status} — ${payload.error ?? "(no message)"}${
          payload.detail ? `\n${typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail)}` : ""
        }`;
        if (response.status === 401) {
          setState({ status: "expired", detail });
          return;
        }
        setState({ status: "error", message: t("mine.error"), detail });
        return;
      }

      setState({ status: "ready", data: (await response.json()) as Loaded });
    } catch {
      setState({ status: "error", message: t("mine.error") });
    }
  }, [getToken, tenantSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmCancel = useCallback(
    async (booking: Booking) => {
      setCancel({ status: "submitting", booking });
      try {
        const idToken = await getToken();
        if (!idToken) {
          // Either navigating to login or an error is now on screen; do not
          // leave a disabled sheet over it.
          setCancel({ status: "idle" });
          return;
        }

        const response = await fetch("/api/bookings/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantSlug, idToken, bookingId: booking.id }),
        });

        if (response.ok) {
          setCancel({ status: "done", booking });
          void load();
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          outcome?: string;
          cutoffMinutes?: number;
        };
        const cutoff = formatMinutesAsDuration(payload.cutoffMinutes ?? 0);
        const message =
          payload.outcome === "too_late" ? t("mine.cancel.tooLate", { cutoff })
          : payload.outcome === "already_cancelled" ? t("mine.cancel.alreadyDone")
          : payload.outcome === "past" || payload.outcome === "not_cancellable" ? t("mine.cancel.notCancellable")
          : null;

        if (message) {
          setCancel({ status: "refused", booking, message });
          // The list is stale in exactly the way the refusal describes.
          void load();
        } else {
          setCancel({ status: "error", booking });
        }
      } catch {
        setCancel({ status: "error", booking });
      }
    },
    [getToken, load, tenantSlug],
  );

  const brandStyle = { "--brand-primary": brandPrimary } as CSSProperties;
  // "done" shows a banner in the list, not the sheet.
  const sheetOpen = cancel.status !== "idle" && cancel.status !== "done";

  return (
    <div style={brandStyle} className="min-h-dvh bg-black/[0.02]">
      <header className="px-4 pt-5 pb-3">
        <p className="truncate text-base font-semibold">{tenantName}</p>
        <p className="text-xs text-black/55">{t("mine.title")}</p>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-32">
        {(state.status === "loading" || state.status === "redirecting") && (
          <p className="py-8 text-center text-sm text-black/50">{t("mine.loading")}</p>
        )}

        {state.status === "expired" && (
          <div>
            <p role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-relaxed text-amber-900">
              {t("mine.expired")}
            </p>
            <button
              type="button"
              onClick={() => {
                if (!liffId) return;
                void loadLiff(liffId).then((liff) => liff.login({ redirectUri: window.location.href }));
              }}
              className="min-h-14 w-full rounded-xl text-base font-semibold text-white active:opacity-80"
              style={{ backgroundColor: "var(--brand-primary)" }}
            >
              {t("mine.relogin")}
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
              onClick={() => void load()}
              className="min-h-11 w-full rounded-xl border-2 border-black/15 text-base font-medium active:opacity-80"
            >
              {t("mine.retry")}
            </button>
          </div>
        )}

        {state.status === "ready" && (
          <>
            {cancel.status === "done" && (
              <p role="status" className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                {t("mine.cancel.done")}
              </p>
            )}

            <section aria-labelledby="upcoming-heading">
              <h2 id="upcoming-heading" className="mb-2 text-xs font-medium text-black/55">
                {t("mine.section.upcoming")}
              </h2>

              {state.data.upcoming.length === 0 ? (
                <div className="rounded-xl border border-black/10 bg-white px-4 py-8 text-center">
                  <p className="text-sm text-black/50">{t("mine.empty")}</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-3">
                  {state.data.upcoming.map((booking) => (
                    <li key={booking.id} className="rounded-xl border border-black/10 bg-white p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm text-black/60">{taipeiDay(booking.startsAt)}</span>
                        <span className="font-mono text-2xl font-semibold tabular-nums">
                          {taipeiTime(booking.startsAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-base font-medium">{booking.serviceName}</p>
                      <p className="mt-0.5 text-sm text-black/55">
                        {[booking.staffName, t("booking.service.duration", { minutes: booking.durationMinutes })]
                          .filter(Boolean)
                          .join("・")}
                        {" ・ "}
                        {formatPriceTwd(booking.priceTwd)}
                      </p>

                      {booking.canCancel ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setCancel({ status: "confirming", booking })}
                            className="mt-4 min-h-11 w-full rounded-xl border-2 border-black/15 text-sm font-medium text-black/80 active:opacity-80"
                          >
                            {t("mine.cancel.cta")}
                          </button>
                          <p className="mt-2 text-center text-xs text-black/45">
                            {t("mine.cancel.deadline", {
                              deadline: formatInstantShort(new Date(booking.cancelDeadline)),
                            })}
                          </p>
                        </>
                      ) : (
                        <p className="mt-4 rounded-lg bg-black/[0.04] px-3 py-2 text-xs leading-relaxed text-black/60">
                          {t("mine.cancel.pastDeadline")}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {state.data.past.length > 0 && (
              <section aria-labelledby="past-heading" className="mt-6">
                <h2 id="past-heading" className="mb-2 text-xs font-medium text-black/55">
                  {t("mine.section.past")}
                </h2>
                <ul className="flex flex-col gap-2">
                  {state.data.past.map((booking) => (
                    <li key={booking.id} className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-black/80">{booking.serviceName}</p>
                        <p className="mt-0.5 text-xs text-black/50">
                          {taipeiDay(booking.startsAt)} {taipeiTime(booking.startsAt)}
                          {booking.staffName ? `・${booking.staffName}` : ""}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${
                          booking.status === "cancelled" || booking.status === "no_show"
                            ? "bg-black/[0.06] text-black/50"
                            : "bg-emerald-50 text-emerald-800"
                        }`}
                      >
                        {t(STATUS_KEY[booking.status] ?? "mine.status.confirmed")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>

      {/* Book-now stays within thumb reach whatever the list length. */}
      {state.status === "ready" && !sheetOpen && (
        <div className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
          <a
            href={bookingHomePath(tenantSlug)}
            className="mx-auto flex min-h-14 w-full max-w-md items-center justify-center rounded-xl text-base font-semibold text-white active:opacity-80"
            style={{ backgroundColor: "var(--brand-primary)" }}
          >
            {t("mine.bookNow")}
          </a>
        </div>
      )}

      {/* Cancel confirmation: a bottom sheet, so both answers sit under the thumb. */}
      {sheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-heading"
          className="fixed inset-0 z-10 flex items-end bg-black/40"
          onClick={() => cancel.status !== "submitting" && setCancel({ status: "idle" })}
        >
          <div
            className="w-full rounded-t-2xl bg-white px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-5"
            onClick={(event) => event.stopPropagation()}
          >
            {cancel.status === "refused" || cancel.status === "error" ? (
              <>
                <p
                  id="cancel-heading"
                  role="alert"
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-relaxed text-amber-900"
                >
                  {cancel.status === "refused" ? cancel.message : t("mine.cancel.error")}
                </p>
                <button
                  type="button"
                  onClick={() => setCancel({ status: "idle" })}
                  className="mt-4 min-h-14 w-full rounded-xl border-2 border-black/15 text-base font-medium active:opacity-80"
                >
                  {t("mine.cancel.keep")}
                </button>
              </>
            ) : (
              <>
                <h2 id="cancel-heading" className="text-base font-semibold">
                  {t("mine.cancel.confirmTitle")}
                </h2>
                <p className="mt-1 text-sm text-black/60">
                  {taipeiDay(cancel.booking.startsAt)} {taipeiTime(cancel.booking.startsAt)}・
                  {cancel.booking.serviceName}
                </p>
                <p className="mt-2 text-xs text-black/50">{t("mine.cancel.confirmHint")}</p>

                <button
                  type="button"
                  disabled={cancel.status === "submitting"}
                  onClick={() => void confirmCancel(cancel.booking)}
                  className="mt-5 min-h-14 w-full rounded-xl bg-red-600 text-base font-semibold text-white active:opacity-80 disabled:opacity-60"
                >
                  {cancel.status === "submitting" ? t("mine.cancel.inProgress") : t("mine.cancel.confirmYes")}
                </button>
                <button
                  type="button"
                  disabled={cancel.status === "submitting"}
                  onClick={() => setCancel({ status: "idle" })}
                  className="mt-2 min-h-14 w-full rounded-xl border-2 border-black/15 text-base font-medium active:opacity-80 disabled:opacity-60"
                >
                  {t("mine.cancel.keep")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
