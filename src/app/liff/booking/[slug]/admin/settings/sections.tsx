"use client";

import { type ReactNode, useEffect, useState } from "react";
import { type MessageKey, t } from "@/i18n";
import { formatDateLong, formatMinutesAsDuration, formatPriceTwd } from "@/i18n/format";
import { CUTOFF_OPTIONS, LIMITS } from "@/lib/admin/limits";
import type { AdminApi, ApiResult, OnSaved, Settings } from "./types";

/**
 * The five editable parts of 店家設定. Each owns its draft and its own save,
 * so a mistake in the hours never blocks fixing a price.
 *
 * Layout is for one thumb at ~375px (CLAUDE.md §6): every control is at least
 * 44px tall, inputs use text-base so iOS does not zoom on focus, and number
 * fields bring up the numeric keypad.
 */

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const INPUT =
  "min-h-11 w-full rounded-lg border border-black/15 bg-white px-3 text-base focus:border-[var(--brand-primary)] focus:outline-none";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-black/10 bg-white">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
        {title}
        <span aria-hidden className="text-black/40 transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="border-t border-black/10 px-4 pt-3 pb-4">{children}</div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-black/60">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-black/45">{hint}</span>}
    </label>
  );
}

function PrimaryButton({ busy, children, ...rest }: { busy: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={busy || rest.disabled}
      className="min-h-12 w-full rounded-xl text-base font-semibold text-white active:opacity-80 disabled:opacity-50"
      style={{ backgroundColor: "var(--brand-primary)" }}
    >
      {busy ? t("admin.settings.saving") : children}
    </button>
  );
}

function SecondaryButton({ children, ...rest }: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`min-h-11 rounded-xl border-2 border-black/15 bg-white px-3 text-sm font-medium active:opacity-80 disabled:opacity-40 ${rest.className ?? ""}`}
    >
      {children}
    </button>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
      {message}
    </p>
  );
}

/** 401 and 403 are handled page-wide; anything else is a message for the section. */
function failureMessage(result: ApiResult, codes: Partial<Record<string, MessageKey>> = {}): string | null {
  if (result.status === 401 || result.status === 403) return null;
  const code = (result.data.detail as { code?: string } | undefined)?.code;
  if (code && codes[code]) return t(codes[code]);
  return result.status === 400 ? t("admin.settings.invalid") : t("admin.settings.saveFailed");
}

/** A number field's text, as an integer or null. Never NaN. */
function toInteger(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

function MoveButtons({
  index,
  count,
  disabled,
  onMove,
}: {
  index: number;
  count: number;
  disabled: boolean;
  onMove: (direction: "up" | "down") => void;
}) {
  return (
    <>
      <SecondaryButton
        aria-label={t("admin.settings.moveUp")}
        disabled={disabled || index === 0}
        onClick={() => onMove("up")}
        className="w-11 px-0"
      >
        <span aria-hidden>↑</span>
      </SecondaryButton>
      <SecondaryButton
        aria-label={t("admin.settings.moveDown")}
        disabled={disabled || index === count - 1}
        onClick={() => onMove("down")}
        className="w-11 px-0"
      >
        <span aria-hidden>↓</span>
      </SecondaryButton>
    </>
  );
}

function ActiveToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 accent-[var(--brand-primary)]"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

function HiddenBadge({ label }: { label: string }) {
  return <span className="shrink-0 rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] text-black/60">{label}</span>;
}

function UpcomingNote({ count }: { count: number }) {
  if (count === 0) return null;
  return <p className="mt-0.5 text-[11px] text-black/45">{t("admin.settings.upcoming", { count })}</p>;
}

/** Shared by both lists: the row being edited, a busy flag, an error, and the move call. */
function useCatalog(api: AdminApi, path: string, onSaved: OnSaved) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await api(path, payload);
    setBusy(false);
    if (result.ok) {
      setEditing(null);
      await onSaved(result.data);
      return;
    }
    setError(failureMessage(result));
  }

  return {
    editing,
    busy,
    error,
    submit,
    startEditing: (target: string | "new" | null) => {
      setError(null);
      setEditing(target);
    },
  };
}

// ---------------------------------------------------------------------------
// 服務項目
// ---------------------------------------------------------------------------

type Service = Settings["services"][number];

function ServiceForm({
  initial,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initial?: Service;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [duration, setDuration] = useState(initial ? String(initial.durationMinutes) : "");
  const [price, setPrice] = useState(initial ? String(initial.priceTwd) : "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [localError, setLocalError] = useState<string | null>(null);

  const hidingWithBookings = Boolean(initial?.isActive && !isActive && initial.upcomingCount > 0);

  return (
    <form
      className="flex flex-col gap-3 rounded-xl bg-black/[0.03] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const durationMinutes = toInteger(duration);
        const priceTwd = toInteger(price);
        if (
          !name.trim() ||
          durationMinutes === null ||
          durationMinutes <= 0 ||
          durationMinutes > LIMITS.maxDurationMinutes ||
          durationMinutes % LIMITS.minuteStep !== 0 ||
          priceTwd === null ||
          priceTwd > LIMITS.maxPriceTwd
        ) {
          setLocalError(t("admin.settings.invalid"));
          return;
        }
        setLocalError(null);
        onSubmit({
          ...(initial ? { action: "update", id: initial.id, isActive } : { action: "create" }),
          name,
          description,
          durationMinutes,
          priceTwd,
        });
      }}
    >
      <Field label={t("admin.settings.services.name")}>
        <input className={INPUT} value={name} maxLength={LIMITS.serviceName} required onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t("admin.settings.services.description")}>
        <textarea
          className={`${INPUT} min-h-20 py-2`}
          value={description}
          maxLength={LIMITS.serviceDescription}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("admin.settings.services.duration")} hint={t("admin.settings.services.durationHint")}>
          <input
            className={INPUT}
            inputMode="numeric"
            pattern="[0-9]*"
            value={duration}
            required
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        <Field label={t("admin.settings.services.price")}>
          <input
            className={INPUT}
            inputMode="numeric"
            pattern="[0-9]*"
            value={price}
            required
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
      </div>
      {initial && <ActiveToggle label={t("admin.settings.services.active")} checked={isActive} onChange={setIsActive} />}
      {hidingWithBookings && initial && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {t("admin.settings.services.hideWarning", { count: initial.upcomingCount })}
        </p>
      )}
      <ErrorText message={localError ?? error} />
      <div className="grid grid-cols-2 gap-2">
        <SecondaryButton onClick={onCancel} disabled={busy}>
          {t("admin.settings.cancel")}
        </SecondaryButton>
        <PrimaryButton type="submit" busy={busy}>
          {t("admin.settings.save")}
        </PrimaryButton>
      </div>
    </form>
  );
}

export function ServicesSection({ services, api, onSaved }: { services: Service[]; api: AdminApi; onSaved: OnSaved }) {
  const catalog = useCatalog(api, "/api/admin/services", onSaved);

  return (
    <Section title={t("admin.settings.services.title")}>
      {services.length === 0 && <p className="mb-3 text-sm text-black/50">{t("admin.settings.services.empty")}</p>}
      <ul className="flex flex-col gap-2">
        {services.map((service, index) =>
          catalog.editing === service.id ? (
            <li key={service.id}>
              <ServiceForm
                initial={service}
                busy={catalog.busy}
                error={catalog.error}
                onCancel={() => catalog.startEditing(null)}
                onSubmit={(payload) => void catalog.submit(payload)}
              />
            </li>
          ) : (
            <li key={service.id} className="flex items-center gap-2 rounded-xl border border-black/10 p-2.5">
              <div className={`min-w-0 flex-1 ${service.isActive ? "" : "opacity-55"}`}>
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{service.name}</p>
                  {!service.isActive && <HiddenBadge label={t("admin.settings.services.hidden")} />}
                </div>
                <p className="text-xs text-black/55">
                  {formatMinutesAsDuration(service.durationMinutes)}・{formatPriceTwd(service.priceTwd)}
                </p>
                <UpcomingNote count={service.upcomingCount} />
              </div>
              <MoveButtons
                index={index}
                count={services.length}
                disabled={catalog.busy || catalog.editing !== null}
                onMove={(direction) => void catalog.submit({ action: "move", id: service.id, direction })}
              />
              <SecondaryButton disabled={catalog.busy} onClick={() => catalog.startEditing(service.id)}>
                {t("admin.settings.edit")}
              </SecondaryButton>
            </li>
          ),
        )}
      </ul>

      <div className="mt-3">
        {catalog.editing === "new" ? (
          <ServiceForm
            busy={catalog.busy}
            error={catalog.error}
            onCancel={() => catalog.startEditing(null)}
            onSubmit={(payload) => void catalog.submit(payload)}
          />
        ) : (
          <>
            {catalog.editing === null && <ErrorText message={catalog.error} />}
            <SecondaryButton className="mt-2 w-full" onClick={() => catalog.startEditing("new")} disabled={catalog.busy}>
              {t("admin.settings.services.add")}
            </SecondaryButton>
          </>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 設計師
// ---------------------------------------------------------------------------

type Stylist = Settings["staff"][number];

function StaffForm({
  initial,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  initial?: Stylist;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [localError, setLocalError] = useState<string | null>(null);

  const hidingWithBookings = Boolean(initial?.isActive && !isActive && initial.upcomingCount > 0);

  return (
    <form
      className="flex flex-col gap-3 rounded-xl bg-black/[0.03] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) {
          setLocalError(t("admin.settings.required"));
          return;
        }
        setLocalError(null);
        onSubmit({
          ...(initial ? { action: "update", id: initial.id, isActive } : { action: "create" }),
          name,
          title,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("admin.settings.staff.name")}>
          <input className={INPUT} value={name} maxLength={LIMITS.staffName} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("admin.settings.staff.jobTitle")}>
          <input className={INPUT} value={title} maxLength={LIMITS.staffTitle} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      {initial && <ActiveToggle label={t("admin.settings.staff.active")} checked={isActive} onChange={setIsActive} />}
      {hidingWithBookings && initial && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {t("admin.settings.staff.hideWarning", { count: initial.upcomingCount })}
        </p>
      )}
      <ErrorText message={localError ?? error} />
      <div className="grid grid-cols-2 gap-2">
        <SecondaryButton onClick={onCancel} disabled={busy}>
          {t("admin.settings.cancel")}
        </SecondaryButton>
        <PrimaryButton type="submit" busy={busy}>
          {t("admin.settings.save")}
        </PrimaryButton>
      </div>
    </form>
  );
}

export function StaffSection({ staff, api, onSaved }: { staff: Stylist[]; api: AdminApi; onSaved: OnSaved }) {
  const catalog = useCatalog(api, "/api/admin/staff", onSaved);

  return (
    <Section title={t("admin.settings.staff.title")}>
      {staff.length === 0 && <p className="mb-3 text-sm text-black/50">{t("admin.settings.staff.empty")}</p>}
      <ul className="flex flex-col gap-2">
        {staff.map((member, index) =>
          catalog.editing === member.id ? (
            <li key={member.id}>
              <StaffForm
                initial={member}
                busy={catalog.busy}
                error={catalog.error}
                onCancel={() => catalog.startEditing(null)}
                onSubmit={(payload) => void catalog.submit(payload)}
              />
            </li>
          ) : (
            <li key={member.id} className="flex items-center gap-2 rounded-xl border border-black/10 p-2.5">
              <div className={`min-w-0 flex-1 ${member.isActive ? "" : "opacity-55"}`}>
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  {!member.isActive && <HiddenBadge label={t("admin.settings.staff.hidden")} />}
                </div>
                {member.title && <p className="truncate text-xs text-black/55">{member.title}</p>}
                <UpcomingNote count={member.upcomingCount} />
              </div>
              <MoveButtons
                index={index}
                count={staff.length}
                disabled={catalog.busy || catalog.editing !== null}
                onMove={(direction) => void catalog.submit({ action: "move", id: member.id, direction })}
              />
              <SecondaryButton disabled={catalog.busy} onClick={() => catalog.startEditing(member.id)}>
                {t("admin.settings.edit")}
              </SecondaryButton>
            </li>
          ),
        )}
      </ul>

      <div className="mt-3">
        {catalog.editing === "new" ? (
          <StaffForm
            busy={catalog.busy}
            error={catalog.error}
            onCancel={() => catalog.startEditing(null)}
            onSubmit={(payload) => void catalog.submit(payload)}
          />
        ) : (
          <>
            {catalog.editing === null && <ErrorText message={catalog.error} />}
            <SecondaryButton className="mt-2 w-full" onClick={() => catalog.startEditing("new")} disabled={catalog.busy}>
              {t("admin.settings.staff.add")}
            </SecondaryButton>
          </>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 營業時間
// ---------------------------------------------------------------------------

/** Monday first, as a Taiwanese opening-hours sign reads. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

type Span = { opensAt: string; closesAt: string };
type Week = Record<number, Span[]>;

function toWeek(hours: Settings["hours"]): Week {
  const week: Week = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const span of hours) week[span.weekday].push({ opensAt: span.opensAt, closesAt: span.closesAt });
  return week;
}

/** Per-day problem, checked before sending; the database re-checks both. */
function dayProblem(spans: Span[]): MessageKey | null {
  // "HH:mm" strings compare correctly as text.
  if (spans.some((span) => !span.opensAt || !span.closesAt || span.closesAt <= span.opensAt)) {
    return "admin.settings.hours.order";
  }
  const sorted = [...spans].sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].opensAt < sorted[i - 1].closesAt) return "admin.settings.hours.overlap";
  }
  return null;
}

export function HoursSection({ hours, api, onSaved }: { hours: Settings["hours"]; api: AdminApi; onSaved: OnSaved }) {
  const saved = JSON.stringify(hours);
  const [week, setWeek] = useState<Week>(() => toWeek(hours));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After any save the page re-reads settings; take the stored week as truth.
  useEffect(() => setWeek(toWeek(JSON.parse(saved) as Settings["hours"])), [saved]);

  const problems = Object.fromEntries(WEEK_ORDER.map((day) => [day, dayProblem(week[day])])) as Record<number, MessageKey | null>;
  const hasProblem = WEEK_ORDER.some((day) => problems[day]);

  function update(day: number, spans: Span[]) {
    setWeek((current) => ({ ...current, [day]: spans }));
  }

  /** Re-opening a day starts from the nearest open day's hours, so the owner rarely types. */
  function reopen(day: number) {
    const template = WEEK_ORDER.map((d) => week[d]).find((spans) => spans.length > 0);
    update(day, template ? template.map((span) => ({ ...span })) : [{ opensAt: "", closesAt: "" }]);
  }

  return (
    <Section title={t("admin.settings.hours.title")}>
      <ul className="flex flex-col gap-3">
        {WEEK_ORDER.map((day) => {
          const spans = week[day];
          const open = spans.length > 0;
          return (
            <li key={day} className="rounded-xl border border-black/10 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{t(`weekday.${day}` as const)}</span>
                <div className="grid grid-cols-2 gap-1" role="group" aria-label={t(`weekday.${day}` as const)}>
                  {[true, false].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      aria-pressed={open === value}
                      onClick={() => {
                        if (!value) update(day, []);
                        else if (!open) reopen(day);
                      }}
                      className="min-h-11 min-w-16 rounded-lg border-2 px-2 text-sm font-medium active:opacity-80"
                      style={{
                        borderColor: open === value ? "var(--brand-primary)" : "rgba(0,0,0,0.12)",
                        backgroundColor: open === value ? "var(--brand-primary)" : "white",
                        color: open === value ? "#ffffff" : undefined,
                      }}
                    >
                      {t(value ? "admin.settings.hours.open" : "admin.settings.hours.closed")}
                    </button>
                  ))}
                </div>
              </div>

              {open && (
                <div className="mt-2 flex flex-col gap-2">
                  {spans.map((span, index) => (
                    <div key={index} className="flex items-end gap-2">
                      <Field label={t("admin.settings.hours.opensAt")}>
                        <input
                          type="time"
                          step={LIMITS.minuteStep * 60}
                          className={INPUT}
                          value={span.opensAt}
                          onChange={(e) =>
                            update(day, spans.map((s, i) => (i === index ? { ...s, opensAt: e.target.value } : s)))
                          }
                        />
                      </Field>
                      <Field label={t("admin.settings.hours.closesAt")}>
                        <input
                          type="time"
                          step={LIMITS.minuteStep * 60}
                          className={INPUT}
                          value={span.closesAt}
                          onChange={(e) =>
                            update(day, spans.map((s, i) => (i === index ? { ...s, closesAt: e.target.value } : s)))
                          }
                        />
                      </Field>
                      {spans.length > 1 && (
                        <SecondaryButton
                          aria-label={t("admin.settings.hours.removeSpan")}
                          onClick={() => update(day, spans.filter((_, i) => i !== index))}
                          className="w-11 shrink-0 px-0"
                        >
                          <span aria-hidden>×</span>
                        </SecondaryButton>
                      )}
                    </div>
                  ))}
                  {problems[day] && <p className="text-xs text-red-800">{t(problems[day])}</p>}
                  {spans.length < 4 && (
                    <SecondaryButton
                      onClick={() => update(day, [...spans, { opensAt: "", closesAt: "" }])}
                      className="self-start"
                    >
                      {t("admin.settings.hours.addSpan")}
                    </SecondaryButton>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-col gap-2">
        <ErrorText message={error} />
        <PrimaryButton
          type="button"
          busy={busy}
          disabled={hasProblem}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const payload = WEEK_ORDER.flatMap((weekday) => week[weekday].map((span) => ({ weekday, ...span })));
            const result = await api("/api/admin/hours", { hours: payload });
            setBusy(false);
            if (result.ok) await onSaved(result.data);
            else setError(failureMessage(result, { overlap: "admin.settings.hours.overlap" }));
          }}
        >
          {t("admin.settings.hours.save")}
        </PrimaryButton>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 公休日
// ---------------------------------------------------------------------------

export function ClosuresSection({
  closedDates,
  today,
  api,
  onSaved,
}: {
  closedDates: string[];
  today: string;
  api: AdminApi;
  onSaved: OnSaved;
}) {
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(action: "add" | "remove", target: string) {
    setBusy(true);
    setError(null);
    const result = await api("/api/admin/closures", { action, date: target });
    setBusy(false);
    if (result.ok) {
      if (action === "add") setDate("");
      await onSaved(result.data);
    } else {
      setError(failureMessage(result, { past: "admin.settings.closures.past" }));
    }
  }

  return (
    <Section title={t("admin.settings.closures.title")}>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // Calendar dates are zero-padded, so text order is date order.
          if (!date) return;
          if (date < today) {
            setError(t("admin.settings.closures.past"));
            return;
          }
          void send("add", date);
        }}
      >
        <div className="min-w-0 flex-1">
          <Field label={t("admin.settings.closures.date")}>
            <input type="date" className={INPUT} min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <button
          type="submit"
          disabled={busy || !date}
          className="min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold text-white active:opacity-80 disabled:opacity-50"
          style={{ backgroundColor: "var(--brand-primary)" }}
        >
          {t("admin.settings.closures.add")}
        </button>
      </form>

      <div className="mt-2">
        <ErrorText message={error} />
      </div>

      {closedDates.length === 0 ? (
        <p className="mt-3 text-sm text-black/50">{t("admin.settings.closures.empty")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {closedDates.map((closed) => (
            <li key={closed} className="flex items-center justify-between gap-2 rounded-xl border border-black/10 py-1.5 pr-1.5 pl-3">
              <span className="text-sm">{formatDateLong(closed)}</span>
              <SecondaryButton
                disabled={busy}
                aria-label={t("admin.settings.closures.removeLabel", { date: formatDateLong(closed) })}
                onClick={() => void send("remove", closed)}
              >
                {t("admin.settings.closures.remove")}
              </SecondaryButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 店家資訊與取消規定
// ---------------------------------------------------------------------------

/** The standard choices, plus the salon's current value if it is not one of them. */
function cutoffChoices(current: number): number[] {
  const choices: number[] = [...CUTOFF_OPTIONS];
  if (!choices.includes(current)) choices.push(current);
  return choices.sort((a, b) => a - b);
}

export function ProfileSection({
  profile,
  api,
  onSaved,
}: {
  profile: Settings["profile"];
  api: AdminApi;
  onSaved: OnSaved;
}) {
  const saved = JSON.stringify(profile);
  const [draft, setDraft] = useState(profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(JSON.parse(saved) as Settings["profile"]), [saved]);

  const set = (key: keyof Settings["profile"]) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft((current) => ({
      ...current,
      [key]: key === "cancellationCutoffMinutes" ? Number(event.target.value) : event.target.value,
    }));

  const urlFields = [
    ["mapsUrl", "admin.settings.profile.mapsUrl"],
    ["instagramUrl", "admin.settings.profile.instagramUrl"],
    ["websiteUrl", "admin.settings.profile.websiteUrl"],
  ] as const;

  return (
    <Section title={t("admin.settings.profile.title")}>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          const result = await api("/api/admin/profile", draft);
          setBusy(false);
          if (result.ok) await onSaved(result.data);
          else setError(failureMessage(result));
        }}
      >
        <Field label={t("admin.settings.profile.address")}>
          <input className={INPUT} value={draft.address} maxLength={LIMITS.address} onChange={set("address")} />
        </Field>
        <Field label={t("admin.settings.profile.phone")}>
          <input
            className={INPUT}
            type="tel"
            inputMode="tel"
            value={draft.phone}
            maxLength={LIMITS.phone}
            onChange={set("phone")}
          />
        </Field>
        {urlFields.map(([key, label]) => (
          <Field key={key} label={t(label)} hint={t("admin.settings.profile.urlHint")}>
            <input
              className={INPUT}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              pattern="https://.*"
              value={draft[key]}
              maxLength={LIMITS.url}
              onChange={set(key)}
            />
          </Field>
        ))}
        <Field label={t("admin.settings.profile.cutoff")}>
          <select className={INPUT} value={draft.cancellationCutoffMinutes} onChange={set("cancellationCutoffMinutes")}>
            {cutoffChoices(profile.cancellationCutoffMinutes).map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0
                  ? t("admin.settings.profile.cutoffAnytime")
                  : t("admin.settings.profile.cutoffBefore", { duration: formatMinutesAsDuration(minutes) })}
              </option>
            ))}
          </select>
        </Field>
        <ErrorText message={error} />
        <PrimaryButton type="submit" busy={busy}>
          {t("admin.settings.profile.save")}
        </PrimaryButton>
      </form>
    </Section>
  );
}
