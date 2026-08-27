"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { TenantConfig } from "@config/tenants/types";
import {
  ANY_STAFF,
  type StaffSelection,
  buildDateOptions,
  generateSlots,
  isSalonOpen,
} from "@/lib/booking/slots";
import { t } from "@/i18n";
import {
  ConfirmStep,
  DateStep,
  ServiceStep,
  StaffStep,
  TimeStep,
} from "./steps";

const STEPS = ["service", "staff", "date", "time", "confirm"] as const;
type StepId = (typeof STEPS)[number];

const STEP_TITLES: Record<StepId, Parameters<typeof t>[0]> = {
  service: "booking.step.service",
  staff: "booking.step.staff",
  date: "booking.step.date",
  time: "booking.step.time",
  confirm: "booking.step.confirm",
};

export default function BookingFlow({ tenant }: { tenant: TenantConfig }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<StaffSelection | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Read the clock after mount only. Availability depends on "now", so
  // computing it during the server render would guarantee a hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const service = useMemo(
    () => tenant.services.find((entry) => entry.id === serviceId) ?? null,
    [tenant.services, serviceId],
  );

  const days = useMemo(
    () => (now ? buildDateOptions(tenant, now) : []),
    [tenant, now],
  );

  const slots = useMemo(() => {
    if (!now || !serviceId || !staffId || !date) return [];
    return generateSlots({ tenant, date, serviceId, staffId, now });
  }, [tenant, date, serviceId, staffId, now]);

  const staffName =
    staffId === ANY_STAFF
      ? t("booking.staff.any")
      : (tenant.staff.find((member) => member.id === staffId)?.name ?? "");

  const step = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;

  const canAdvance =
    (step === "service" && serviceId !== null) ||
    (step === "staff" && staffId !== null) ||
    (step === "date" && date !== null) ||
    (step === "time" && time !== null) ||
    step === "confirm";

  function reset() {
    setStepIndex(0);
    setServiceId(null);
    setStaffId(null);
    setDate(null);
    setTime(null);
    setIsSubmitted(false);
  }

  const brandStyle = {
    "--brand-primary": tenant.brand.primary,
    "--brand-on-primary": tenant.brand.onPrimary,
    "--brand-accent": tenant.brand.accent,
  } as CSSProperties;

  return (
    <div style={brandStyle} className="min-h-dvh bg-black/[0.02]">
      <header className="flex items-center gap-3 px-4 pt-5 pb-3">
        <Image
          src={tenant.logoUrl}
          alt=""
          width={40}
          height={40}
          className="size-10 rounded-full"
        />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{tenant.name}</p>
          <p className="text-xs text-black/55">{t("booking.title")}</p>
        </div>
      </header>

      {/* pb-36 keeps content clear of the fixed action bar. */}
      <main className="mx-auto w-full max-w-md px-4 pb-36">
        {isSubmitted ? (
          <section className="rounded-xl border border-black/10 bg-white p-5 text-center">
            <h1 className="text-lg font-semibold">{t("booking.done.title")}</h1>
            <p className="mt-2 text-sm text-black/60">
              {t("booking.done.notice")}
            </p>
          </section>
        ) : (
          <>
            <div className="mb-3">
              <p className="text-xs text-black/50">
                {t("booking.progress", {
                  current: stepIndex + 1,
                  total: STEPS.length,
                })}
              </p>
              <h1 className="text-lg font-semibold">{t(STEP_TITLES[step])}</h1>
            </div>

            <>
              {step === "service" && (
                <ServiceStep
                  services={tenant.services}
                  selectedId={serviceId}
                  onSelect={(id) => {
                    setServiceId(id);
                    // Duration changes which slots fit, so any held time is stale.
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
                  <p className="text-sm text-black/50">
                    {t("booking.loading")}
                  </p>
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

              {step === "time" &&
                service &&
                date &&
                (now === null ? (
                  <p className="text-sm text-black/50">
                    {t("booking.loading")}
                  </p>
                ) : (
                  <TimeStep
                    slots={slots}
                    isOpen={isSalonOpen(tenant, date)}
                    selectedTime={time}
                    serviceName={service.name}
                    serviceMinutes={service.durationMinutes}
                    onSelect={setTime}
                  />
                ))}

              {step === "confirm" && service && date && time && (
                <ConfirmStep
                  service={service}
                  staffName={staffName}
                  date={date}
                  time={time}
                />
              )}
            </>
          </>
        )}
      </main>

      {/* Fixed to the bottom so the primary action stays under the thumb, with
          safe-area padding for the LINE in-app browser (CLAUDE.md §6). */}
      <div className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="mx-auto flex w-full max-w-md gap-3">
          {isSubmitted ? (
            <button
              type="button"
              onClick={reset}
              className="min-h-14 flex-1 rounded-xl text-base font-semibold active:opacity-80"
              style={{
                backgroundColor: "var(--brand-primary)",
                color: "var(--brand-on-primary)",
              }}
            >
              {t("booking.action.restart")}
            </button>
          ) : (
            <>
              {stepIndex > 0 && (
                <button
                  type="button"
                  onClick={() => setStepIndex((index) => index - 1)}
                  className="min-h-14 min-w-24 rounded-xl border-2 border-black/15 px-4 text-base font-medium active:opacity-80"
                >
                  {t("booking.action.back")}
                </button>
              )}
              <button
                type="button"
                disabled={!canAdvance}
                onClick={() => {
                  if (isLastStep) {
                    setIsSubmitted(true);
                    return;
                  }
                  setStepIndex((index) => index + 1);
                }}
                className="min-h-14 flex-1 rounded-xl text-base font-semibold active:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
                style={{
                  backgroundColor: "var(--brand-primary)",
                  color: "var(--brand-on-primary)",
                }}
              >
                {isLastStep
                  ? t("booking.action.confirm")
                  : t("booking.action.next")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
