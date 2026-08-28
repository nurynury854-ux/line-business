"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { TenantConfig } from "@config/tenants/types";
import { ANY_STAFF, type StaffSelection, buildDateOptions, isSalonOpen } from "@/lib/booking/slots";
import { t } from "@/i18n";
import { formatDateLong, formatPriceTwd } from "@/i18n/format";
import { ConfirmStep, DateStep, ServiceStep, StaffStep, TimeStep } from "./steps";

const STEPS = ["service", "staff", "date", "time", "confirm"] as const;
type StepId = (typeof STEPS)[number];
const TIME_STEP_INDEX = STEPS.indexOf("time");

const STEP_TITLES: Record<StepId, Parameters<typeof t>[0]> = {
  service: "booking.step.service",
  staff: "booking.step.staff",
  date: "booking.step.date",
  time: "booking.step.time",
  confirm: "booking.step.confirm",
};

/** Server-derived slot. Same shape the client grid used, now sourced from the DB. */
type DaySlot = { start: string; isAvailable: boolean; reason?: "past" | "booked" };

type SlotState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; slots: DaySlot[] }
  | { status: "error" };

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "redirecting" }
  | { status: "error"; message: string; wasConflict: boolean }
  | { status: "success"; bookingId: string; reassigned: boolean };

/**
 * LIFF is initialised once per page load and cached at module scope: liff.init()
 * is not idempotent, and React re-renders (and StrictMode) would otherwise call
 * it repeatedly.
 */
let liffPromise: Promise<typeof import("@line/liff").default> | null = null;

function loadLiff(liffId: string) {
  if (!liffPromise) {
    liffPromise = (async () => {
      const liff = (await import("@line/liff")).default;
      await liff.init({ liffId });
      return liff;
    })().catch((error) => {
      // Do not cache a failure: a retry should be able to try again.
      liffPromise = null;
      throw error;
    });
  }
  return liffPromise;
}

export default function BookingFlow({
  tenant,
  tenantSlug,
  liffId,
}: {
  tenant: TenantConfig;
  tenantSlug: string;
  liffId?: string;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<StaffSelection | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);

  const [slotState, setSlotState] = useState<SlotState>({ status: "idle" });
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [liffReady, setLiffReady] = useState<boolean | null>(null);

  // Availability depends on "now", so reading the clock during the server render
  // would guarantee a hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  // Warm LIFF up front so the submit tap is not the first thing that touches it,
  // but do NOT redirect to login here: inside LINE the user is already logged
  // in, and outside it an immediate bounce would stop anyone browsing the screen.
  // Login happens at submit, where it is expected.
  useEffect(() => {
    if (!liffId) {
      setLiffReady(false);
      return;
    }
    let cancelled = false;
    loadLiff(liffId)
      .then(() => !cancelled && setLiffReady(true))
      .catch(() => !cancelled && setLiffReady(false));
    return () => {
      cancelled = true;
    };
  }, [liffId]);

  const service = useMemo(
    () => tenant.services.find((entry) => entry.id === serviceId) ?? null,
    [tenant.services, serviceId],
  );

  const days = useMemo(() => (now ? buildDateOptions(tenant, now) : []), [tenant, now]);

  const staffName =
    staffId === ANY_STAFF
      ? t("booking.staff.any")
      : (tenant.staff.find((member) => member.id === staffId)?.name ?? "");

  /** Real availability, from the database — not the config's mock bookings. */
  const loadSlots = useCallback(async () => {
    if (!serviceId || !staffId || !date) return;
    setSlotState({ status: "loading" });
    try {
      const response = await fetch(
        `/api/availability?tenantSlug=${encodeURIComponent(tenantSlug)}` +
          `&serviceId=${encodeURIComponent(serviceId)}` +
          `&staffId=${encodeURIComponent(staffId)}&date=${encodeURIComponent(date)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { slots: DaySlot[] };
      setSlotState({ status: "loaded", slots: payload.slots });
    } catch {
      setSlotState({ status: "error" });
    }
  }, [tenantSlug, serviceId, staffId, date]);

  const step = STEPS[stepIndex];
  useEffect(() => {
    if (step === "time") void loadSlots();
  }, [step, loadSlots]);

  const isLastStep = stepIndex === STEPS.length - 1;
  const canAdvance =
    (step === "service" && serviceId !== null) ||
    (step === "staff" && staffId !== null) ||
    (step === "date" && date !== null) ||
    (step === "time" && time !== null) ||
    step === "confirm";

  async function submitBooking() {
    if (!liffId) {
      setSubmit({ status: "error", message: t("booking.liff.unavailable"), wasConflict: false });
      return;
    }
    setSubmit({ status: "submitting" });

    try {
      const liff = await loadLiff(liffId);

      if (!liff.isLoggedIn()) {
        setSubmit({ status: "redirecting" });
        liff.login({ redirectUri: window.location.href });
        return;
      }

      const idToken = liff.getIDToken();
      if (!idToken) {
        // Almost always a missing `openid` scope on the LIFF app.
        setSubmit({ status: "error", message: t("booking.error.needLogin"), wasConflict: false });
        return;
      }

      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Note what is NOT sent: no userId, no customer id, nothing about
        // availability. The server derives identity from the token and re-derives
        // availability itself; sending either would be rejected with a 400.
        body: JSON.stringify({ tenantSlug, idToken, serviceId, staffId, date, time }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        booking?: { id: string };
        reassigned?: boolean;
      };

      if (response.status === 201 && payload.booking) {
        setSubmit({
          status: "success",
          bookingId: payload.booking.id,
          reassigned: Boolean(payload.reassigned),
        });
        return;
      }

      if (response.status === 409) {
        // Someone took it between the grid render and the tap. Send the customer
        // back to a FRESHLY loaded grid rather than showing a dead end.
        setTime(null);
        setStepIndex(TIME_STEP_INDEX);
        setSubmit({ status: "error", message: t("booking.error.conflict"), wasConflict: true });
        void loadSlots();
        return;
      }

      setSubmit({
        status: "error",
        wasConflict: false,
        message:
          response.status === 422
            ? t("booking.error.notBookable")
            : t("booking.error.generic"),
      });
    } catch {
      setSubmit({ status: "error", message: t("booking.error.network"), wasConflict: false });
    }
  }

  function reset() {
    setStepIndex(0);
    setServiceId(null);
    setStaffId(null);
    setDate(null);
    setTime(null);
    setSlotState({ status: "idle" });
    setSubmit({ status: "idle" });
  }

  const brandStyle = {
    "--brand-primary": tenant.brand.primary,
    "--brand-on-primary": tenant.brand.onPrimary,
    "--brand-accent": tenant.brand.accent,
  } as CSSProperties;

  const busy = submit.status === "submitting" || submit.status === "redirecting";

  return (
    <div style={brandStyle} className="min-h-dvh bg-black/[0.02]">
      <header className="flex items-center gap-3 px-4 pt-5 pb-3">
        <Image src={tenant.logoUrl} alt="" width={40} height={40} className="size-10 rounded-full" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{tenant.name}</p>
          <p className="text-xs text-black/55">{t("booking.title")}</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-40">
        {submit.status === "success" ? (
          <SuccessPanel
            bookingId={submit.bookingId}
            reassigned={submit.reassigned}
            service={service}
            staffName={staffName}
            date={date}
            time={time}
          />
        ) : (
          <>
            <div className="mb-3">
              <p className="text-xs text-black/50">
                {t("booking.progress", { current: stepIndex + 1, total: STEPS.length })}
              </p>
              <h1 className="text-lg font-semibold">{t(STEP_TITLES[step])}</h1>
            </div>

            {submit.status === "error" && (
              <Notice tone={submit.wasConflict ? "warning" : "error"}>{submit.message}</Notice>
            )}

            {step === "service" && (
              <ServiceStep
                services={tenant.services}
                selectedId={serviceId}
                onSelect={(id) => {
                  setServiceId(id);
                  setTime(null);
                }}
              />
            )}

            {step === "staff" && (
              <StaffStep
                staff={tenant.staff}
                selectedId={staffId}
                onSelect={(id) => {
                  setStaffId(id);
                  setTime(null);
                }}
              />
            )}

            {step === "date" &&
              (now === null ? (
                <p className="text-sm text-black/50">{t("booking.loading")}</p>
              ) : (
                <DateStep
                  days={days}
                  selectedDate={date}
                  onSelect={(next) => {
                    setDate(next);
                    setTime(null);
                  }}
                />
              ))}

            {step === "time" && service && date && (
              <>
                {slotState.status === "loading" && (
                  <p className="py-6 text-center text-sm text-black/50">
                    {t("booking.slots.loading")}
                  </p>
                )}
                {slotState.status === "error" && (
                  <div>
                    <Notice tone="error">{t("booking.slots.error")}</Notice>
                    <button
                      type="button"
                      onClick={() => void loadSlots()}
                      className="min-h-11 w-full rounded-xl border-2 border-black/15 text-base font-medium active:opacity-80"
                    >
                      {t("booking.slots.retry")}
                    </button>
                  </div>
                )}
                {slotState.status === "loaded" && (
                  <TimeStep
                    slots={slotState.slots}
                    isOpen={isSalonOpen(tenant, date)}
                    selectedTime={time}
                    serviceName={service.name}
                    serviceMinutes={service.durationMinutes}
                    onSelect={setTime}
                  />
                )}
              </>
            )}

            {step === "confirm" && service && date && time && (
              <ConfirmStep service={service} staffName={staffName} date={date} time={time} />
            )}

            {isLastStep && liffReady === false && (
              <div className="mt-3">
                <Notice tone="warning">{t("booking.liff.needLogin")}</Notice>
              </div>
            )}
          </>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="mx-auto flex w-full max-w-md gap-3">
          {submit.status === "success" ? (
            <PrimaryButton onClick={reset}>{t("booking.action.restart")}</PrimaryButton>
          ) : (
            <>
              {stepIndex > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStepIndex((index) => index - 1)}
                  className="min-h-14 min-w-24 rounded-xl border-2 border-black/15 px-4 text-base font-medium active:opacity-80 disabled:opacity-40"
                >
                  {t("booking.action.back")}
                </button>
              )}
              <PrimaryButton
                disabled={!canAdvance || busy}
                onClick={() => {
                  if (isLastStep) {
                    void submitBooking();
                    return;
                  }
                  setStepIndex((index) => index + 1);
                }}
              >
                {submit.status === "submitting"
                  ? t("booking.submit.inProgress")
                  : submit.status === "redirecting"
                    ? t("booking.liff.redirecting")
                    : isLastStep
                      ? t("booking.action.confirm")
                      : t("booking.action.next")}
              </PrimaryButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-14 flex-1 rounded-xl text-base font-semibold active:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
      style={{ backgroundColor: "var(--brand-primary)", color: "var(--brand-on-primary)" }}
    >
      {children}
    </button>
  );
}

function Notice({ tone, children }: { tone: "error" | "warning"; children: React.ReactNode }) {
  const palette =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <p role="alert" className={`mb-3 rounded-xl border px-3 py-2.5 text-sm leading-relaxed ${palette}`}>
      {children}
    </p>
  );
}

function SuccessPanel({
  bookingId,
  reassigned,
  service,
  staffName,
  date,
  time,
}: {
  bookingId: string;
  reassigned: boolean;
  service: { name: string; priceTwd: number } | null;
  staffName: string;
  date: string | null;
  time: string | null;
}) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <div
        className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full text-2xl"
        style={{ backgroundColor: "color-mix(in srgb, var(--brand-primary) 12%, white)" }}
        aria-hidden
      >
        ✓
      </div>
      <h1 className="text-center text-lg font-semibold">{t("booking.done.title")}</h1>

      {reassigned && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {t("booking.done.reassigned")}
        </p>
      )}

      <dl className="mt-4 space-y-2 text-sm">
        {service && <SummaryLine label={t("booking.summary.service")} value={service.name} />}
        <SummaryLine label={t("booking.summary.staff")} value={staffName} />
        {date && <SummaryLine label={t("booking.summary.date")} value={formatDateLong(date)} />}
        {time && <SummaryLine label={t("booking.summary.time")} value={time} />}
        {service && (
          <SummaryLine label={t("booking.summary.price")} value={formatPriceTwd(service.priceTwd)} />
        )}
      </dl>

      <p className="mt-4 border-t border-black/10 pt-3 text-xs text-black/45">
        {t("booking.done.reference")}
        <span className="ml-1 font-mono break-all">{bookingId}</span>
      </p>
    </section>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-black/55">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
