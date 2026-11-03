"use client";

import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { acquireFreshIdToken } from "@/lib/liff/id-token";
import { loadLiff } from "@/lib/liff/load";
import {
  ClosuresSection,
  HoursSection,
  ProfileSection,
  ServicesSection,
  StaffSection,
} from "./sections";
import type { AdminApi, ApiResult, Settings } from "./types";

type Phase =
  | { status: "loading" }
  | { status: "redirecting" }
  | { status: "ready"; settings: Settings }
  | { status: "denied" }
  /** The ID token LIFF handed us was rejected — almost always an expired one. */
  | { status: "expired" }
  | { status: "error"; message: string; detail?: string };

/** What the bottom bar says after a save. */
type Notice = { kind: "saved" } | { kind: "affected"; count: number } | null;

export default function OwnerSettings({
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
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [notice, setNotice] = useState<Notice>(null);

  /**
   * One POST to an /api/admin route with a fresh ID token. 401 and 403 move the
   * whole page to the matching state — every section shares one login — and
   * any other failure is returned for the section to word.
   */
  const api: AdminApi = useCallback(
    async (path, payload) => {
      if (!liffId) {
        setPhase({ status: "error", message: t("admin.settings.error") });
        return { ok: false, status: 0, data: {} };
      }
      const liff = await loadLiff(liffId);
      const token = acquireFreshIdToken(liff);
      if (token.status === "redirecting") {
        setPhase({ status: "redirecting" });
        return { ok: false, status: 0, data: {} };
      }
      if (token.status === "unavailable") {
        const isScopeProblem = token.reason.includes("openid");
        setPhase({
          status: "error",
          message: isScopeProblem ? t("admin.needLogin") : t("admin.openInLine"),
          detail: token.reason,
        });
        return { ok: false, status: 0, data: {} };
      }

      let response: Response;
      try {
        response = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantSlug, idToken: token.idToken, ...payload }),
        });
      } catch {
        return { ok: false, status: 0, data: {} };
      }
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (response.status === 401) setPhase({ status: "expired" });
      if (response.status === 403) setPhase({ status: "denied" });
      return { ok: response.ok, status: response.status, data } satisfies ApiResult;
    },
    [liffId, tenantSlug],
  );

  const load = useCallback(async () => {
    const result = await api("/api/admin/settings", {});
    if (result.ok) {
      setPhase({ status: "ready", settings: result.data as unknown as Settings });
    } else if (result.status !== 0 && result.status !== 401 && result.status !== 403) {
      setPhase({
        status: "error",
        message: t("admin.settings.error"),
        detail: `HTTP ${result.status} — ${String(result.data.error ?? "(no message)")}`,
      });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every section calls this after a successful write: re-read, then tell the owner. */
  const onSaved = useCallback(
    async (data: Record<string, unknown>) => {
      const affected = typeof data.affectedCount === "number" ? data.affectedCount : 0;
      setNotice(affected > 0 ? { kind: "affected", count: affected } : { kind: "saved" });
      await load();
    },
    [load],
  );

  // A plain "saved" fades; an affected-bookings warning stays until dismissed by
  // the next save, because it asks the owner to do something.
  useEffect(() => {
    if (notice?.kind !== "saved") return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const scheduleHref = `/liff/booking/${tenantSlug}/admin`;

  return (
    <div
      style={{ "--brand-primary": brandPrimary } as CSSProperties}
      className="min-h-dvh bg-black/[0.02]"
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-5 pb-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{tenantName}</p>
          <p className="text-xs text-black/55">{t("admin.settings.title")}</p>
        </div>
        <Link
          href={scheduleHref}
          className="flex min-h-11 shrink-0 items-center rounded-xl border-2 border-black/15 bg-white px-3 text-sm font-medium active:opacity-80"
        >
          {t("admin.settings.back")}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-32">
        {(phase.status === "loading" || phase.status === "redirecting") && (
          <p className="py-8 text-center text-sm text-black/50">{t("admin.settings.loading")}</p>
        )}

        {phase.status === "denied" && (
          <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            {t("admin.notAdmin")}
          </p>
        )}

        {phase.status === "expired" && (
          <div>
            <p role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-relaxed text-amber-900">
              {t("admin.expired")}
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
              {t("admin.relogin")}
            </button>
          </div>
        )}

        {phase.status === "error" && (
          <div>
            <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900">
              {phase.message}
            </p>
            {phase.detail && (
              <pre className="mb-3 select-all whitespace-pre-wrap break-words rounded-lg bg-red-50 p-2.5 font-mono text-[11px] leading-relaxed text-red-900">
                {phase.detail}
              </pre>
            )}
            <button
              type="button"
              onClick={() => {
                setPhase({ status: "loading" });
                void load();
              }}
              className="min-h-11 w-full rounded-xl border-2 border-black/15 text-base font-medium active:opacity-80"
            >
              {t("admin.retry")}
            </button>
          </div>
        )}

        {phase.status === "ready" && (
          <>
            <ServicesSection services={phase.settings.services} api={api} onSaved={onSaved} />
            <StaffSection staff={phase.settings.staff} api={api} onSaved={onSaved} />
            <HoursSection hours={phase.settings.hours} api={api} onSaved={onSaved} />
            <ClosuresSection
              closedDates={phase.settings.closedDates}
              today={phase.settings.today}
              api={api}
              onSaved={onSaved}
            />
            <ProfileSection profile={phase.settings.profile} api={api} onSaved={onSaved} />
            <p className="px-1 text-xs leading-relaxed text-black/45">{t("admin.settings.managedElsewhere")}</p>
          </>
        )}
      </main>

      {notice && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur"
        >
          {notice.kind === "saved" ? (
            <p className="mx-auto max-w-md py-2 text-center text-sm font-medium">{t("admin.settings.saved")}</p>
          ) : (
            <div className="mx-auto max-w-md">
              <p className="mb-2 text-sm leading-relaxed text-amber-900">
                {t("admin.settings.affected", { count: notice.count })}
              </p>
              <Link
                href={`${scheduleHref}?range=attention`}
                className="flex min-h-12 w-full items-center justify-center rounded-xl text-base font-semibold text-white active:opacity-80"
                style={{ backgroundColor: "var(--brand-primary)" }}
              >
                {t("admin.settings.viewAffected")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
