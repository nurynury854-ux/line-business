import type { ReactNode } from "react";
import type { Service, Staff } from "@config/tenants/types";
import type { DayOption, Slot, StaffSelection } from "@/lib/booking/slots";
import { ANY_STAFF } from "@/lib/booking/slots";
import { t } from "@/i18n";
import {
  formatDateLong,
  formatDayShort,
  formatPriceTwd,
  formatWeekday,
} from "@/i18n/format";

/**
 * Presentational steps. Every label is an i18n key and every value comes from
 * tenant config — nothing here knows which salon it is rendering.
 *
 * Tap targets are min-h-11 (44px) or larger throughout (CLAUDE.md §6).
 */

function OptionRow({
  isSelected,
  onSelect,
  children,
}: {
  isSelected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className="min-h-14 w-full rounded-xl border-2 bg-white p-3 text-left transition-colors active:opacity-80"
      style={{
        borderColor: isSelected ? "var(--brand-primary)" : "rgba(0,0,0,0.12)",
        backgroundColor: isSelected
          ? "color-mix(in srgb, var(--brand-primary) 6%, white)"
          : undefined,
      }}
    >
      {children}
    </button>
  );
}

export function ServiceStep({
  services,
  selectedId,
  onSelect,
}: {
  services: Service[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {services.map((service) => (
        <li key={service.id}>
          <OptionRow
            isSelected={service.id === selectedId}
            onSelect={() => onSelect(service.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-medium">{service.name}</p>
                {service.description && (
                  <p className="mt-0.5 text-xs text-black/55">
                    {service.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-black/55">
                  {t("booking.service.duration", {
                    minutes: service.durationMinutes,
                  })}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold">
                {formatPriceTwd(service.priceTwd)}
              </p>
            </div>
          </OptionRow>
        </li>
      ))}
    </ul>
  );
}

export function StaffStep({
  staff,
  selectedId,
  onSelect,
}: {
  staff: Staff[];
  selectedId: StaffSelection | null;
  onSelect: (id: StaffSelection) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      <li>
        <OptionRow
          isSelected={selectedId === ANY_STAFF}
          onSelect={() => onSelect(ANY_STAFF)}
        >
          <p className="text-base font-medium">{t("booking.staff.any")}</p>
          <p className="mt-0.5 text-xs text-black/55">
            {t("booking.staff.anyHint")}
          </p>
        </OptionRow>
      </li>
      {staff.map((member) => (
        <li key={member.id}>
          <OptionRow
            isSelected={member.id === selectedId}
            onSelect={() => onSelect(member.id)}
          >
            <p className="text-base font-medium">{member.name}</p>
            {member.title && (
              <p className="mt-0.5 text-xs text-black/55">{member.title}</p>
            )}
          </OptionRow>
        </li>
      ))}
    </ul>
  );
}

export function DateStep({
  days,
  selectedDate,
  onSelect,
}: {
  days: DayOption[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  return (
    <ul className="grid grid-cols-4 gap-2">
      {days.map((day) => {
        const isSelected = day.date === selectedDate;
        return (
          <li key={day.date}>
            <button
              type="button"
              disabled={!day.isOpen}
              aria-pressed={isSelected}
              onClick={() => onSelect(day.date)}
              className="flex min-h-16 w-full flex-col items-center justify-center rounded-xl border-2 px-1 py-2 disabled:cursor-not-allowed"
              style={{
                borderColor: isSelected
                  ? "var(--brand-primary)"
                  : "rgba(0,0,0,0.12)",
                backgroundColor: !day.isOpen
                  ? "rgba(0,0,0,0.04)"
                  : isSelected
                    ? "color-mix(in srgb, var(--brand-primary) 6%, white)"
                    : "white",
                color: day.isOpen ? undefined : "rgba(0,0,0,0.35)",
              }}
            >
              <span className="text-[11px]">{formatWeekday(day.date)}</span>
              <span className="text-base font-semibold tabular-nums">
                {formatDayShort(day.date)}
              </span>
              <span className="text-[10px] text-black/45">
                {!day.isOpen
                  ? t("booking.date.closed")
                  : day.isToday
                    ? t("booking.date.today")
                    : " "}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TimeStep({
  slots,
  isOpen,
  selectedTime,
  serviceName,
  serviceMinutes,
  onSelect,
}: {
  slots: Slot[];
  isOpen: boolean;
  selectedTime: string | null;
  serviceName: string;
  serviceMinutes: number;
  onSelect: (time: string) => void;
}) {
  if (!isOpen) {
    return (
      <p className="text-sm text-black/60">{t("booking.time.closedNotice")}</p>
    );
  }

  if (slots.length === 0) {
    return (
      <p className="text-sm text-black/60">{t("booking.time.emptyNotice")}</p>
    );
  }

  return (
    <div>
      <p className="mb-2 text-xs text-black/55">
        {t("booking.time.forService", {
          service: serviceName,
          minutes: serviceMinutes,
        })}
      </p>
      <ul className="grid grid-cols-3 gap-2">
        {slots.map((slot) => {
          const isSelected = slot.start === selectedTime;
          return (
            <li key={slot.start}>
              <button
                type="button"
                disabled={!slot.isAvailable}
                aria-pressed={isSelected}
                onClick={() => onSelect(slot.start)}
                className="min-h-11 w-full rounded-lg border-2 text-base tabular-nums disabled:cursor-not-allowed disabled:line-through"
                style={{
                  borderColor: isSelected
                    ? "var(--brand-primary)"
                    : "rgba(0,0,0,0.12)",
                  backgroundColor: !slot.isAvailable
                    ? "rgba(0,0,0,0.04)"
                    : isSelected
                      ? "var(--brand-primary)"
                      : "white",
                  color: !slot.isAvailable
                    ? "rgba(0,0,0,0.35)"
                    : isSelected
                      ? "var(--brand-on-primary)"
                      : undefined,
                }}
              >
                {slot.start}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-black/45">{t("booking.time.legend")}</p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-black/10 py-3 last:border-b-0">
      <dt className="shrink-0 text-sm text-black/55">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

export function ConfirmStep({
  service,
  staffName,
  date,
  time,
}: {
  service: Service;
  staffName: string;
  date: string;
  time: string;
}) {
  return (
    <dl className="rounded-xl border border-black/10 bg-white px-4">
      <SummaryRow label={t("booking.summary.service")} value={service.name} />
      <SummaryRow label={t("booking.summary.staff")} value={staffName} />
      <SummaryRow
        label={t("booking.summary.date")}
        value={formatDateLong(date)}
      />
      <SummaryRow label={t("booking.summary.time")} value={time} />
      <SummaryRow
        label={t("booking.summary.duration")}
        value={t("booking.service.duration", {
          minutes: service.durationMinutes,
        })}
      />
      <SummaryRow
        label={t("booking.summary.price")}
        value={formatPriceTwd(service.priceTwd)}
      />
    </dl>
  );
}
