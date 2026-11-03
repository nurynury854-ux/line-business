import type { CSSProperties } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { Weekday } from "@config/tenants/types";
import { t } from "@/i18n";
import { formatDateLong, formatMinutesAsDuration } from "@/i18n/format";
import { calendarDateInTaipei, weekdayOf } from "@/lib/time/taipei";
import { loadTenantBySlug } from "@/lib/tenants/load";
import { bookingHomePath, isTenantSlug } from "@/lib/tenants/slug";

/**
 * 店家資訊 — hours, address, phone, links. Everything on it is a tenant row
 * (CLAUDE.md §5); a field the salon has not filled in is simply not rendered.
 *
 * A server component with no client JavaScript: it needs no LINE identity, so
 * it also opens in an ordinary browser. It still lives under /liff/booking so
 * the rich menu can link to it as https://liff.line.me/{liffId}/info like the
 * other pages.
 */

export const dynamic = "force-dynamic";

/** Monday first, as a Taiwanese opening-hours sign reads. */
const WEEK_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

const MAX_CLOSURES_SHOWN = 5;

export default async function InfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isTenantSlug(slug)) notFound();

  const loaded = await loadTenantBySlug(slug);
  if (!loaded) notFound();
  const { tenant } = loaded;
  const { contact } = tenant;

  // "Today" in Asia/Taipei, never the server's clock (CLAUDE.md §4).
  const today = calendarDateInTaipei(new Date());
  const todayWeekday = weekdayOf(today);
  const upcomingClosures = tenant.closedDates
    .filter((date) => date >= today)
    .sort()
    .slice(0, MAX_CLOSURES_SHOWN);

  const cutoff = tenant.booking.cancellationCutoffMinutes;
  const links = [
    contact.mapsUrl && { href: contact.mapsUrl, label: t("info.action.map") },
    contact.phone && { href: `tel:${contact.phone.replace(/[^\d+]/g, "")}`, label: t("info.action.call") },
    contact.instagramUrl && { href: contact.instagramUrl, label: t("info.action.instagram") },
    contact.websiteUrl && { href: contact.websiteUrl, label: t("info.action.website") },
  ].filter((link): link is { href: string; label: string } => Boolean(link));

  return (
    <div
      style={{ "--brand-primary": tenant.brand.primary } as CSSProperties}
      className="min-h-dvh bg-black/[0.02]"
    >
      <header className="flex items-center gap-3 px-4 pt-5 pb-3">
        {tenant.logoUrl && (
          <Image src={tenant.logoUrl} alt="" width={40} height={40} className="size-10 rounded-full" />
        )}
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{tenant.name}</p>
          <p className="text-xs text-black/55">{t("info.title")}</p>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-32">
        {/* Hours */}
        <section aria-labelledby="hours-heading" className="rounded-xl border border-black/10 bg-white p-4">
          <h2 id="hours-heading" className="mb-3 text-sm font-semibold">
            {t("info.hours")}
          </h2>
          <dl className="flex flex-col gap-1.5">
            {WEEK_ORDER.map((weekday) => {
              const spans = tenant.businessHours[weekday];
              const isToday = weekday === todayWeekday;
              return (
                <div
                  key={weekday}
                  className={`flex items-baseline justify-between gap-4 rounded-lg px-2 py-1.5 text-sm ${
                    isToday ? "bg-black/[0.04] font-medium" : ""
                  }`}
                >
                  <dt className={isToday ? "" : "text-black/60"}>{t(`weekday.${weekday}` as const)}</dt>
                  <dd className="text-right tabular-nums">
                    {spans.length === 0
                      ? <span className="text-black/45">{t("info.hours.closed")}</span>
                      : spans.map((span) => `${span.start}–${span.end}`).join("、")}
                  </dd>
                </div>
              );
            })}
          </dl>

          {upcomingClosures.length > 0 && (
            <div className="mt-4 border-t border-black/10 pt-3">
              <h3 className="mb-1.5 text-xs font-medium text-black/55">{t("info.closures")}</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {upcomingClosures.map((date) => (
                  <li key={date}>{formatDateLong(date)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Where and how to reach */}
        {(contact.address || contact.phone) && (
          <section className="rounded-xl border border-black/10 bg-white p-4">
            <dl className="flex flex-col gap-3 text-sm">
              {contact.address && (
                <div>
                  <dt className="text-xs text-black/55">{t("info.address")}</dt>
                  <dd className="mt-0.5 leading-relaxed">{contact.address}</dd>
                </div>
              )}
              {contact.phone && (
                <div>
                  <dt className="text-xs text-black/55">{t("info.phone")}</dt>
                  <dd className="mt-0.5 tabular-nums">{contact.phone}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {links.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target={link.href.startsWith("tel:") ? undefined : "_blank"}
                rel="noreferrer"
                className="flex min-h-12 items-center justify-center rounded-xl border-2 border-black/15 bg-white text-sm font-medium active:opacity-80"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}

        {/* Policy */}
        <section aria-labelledby="policy-heading" className="rounded-xl border border-black/10 bg-white p-4">
          <h2 id="policy-heading" className="mb-2 text-sm font-semibold">
            {t("info.policy")}
          </h2>
          <p className="text-sm leading-relaxed text-black/70">
            {cutoff > 0
              ? t("info.policy.cancel", { cutoff: formatMinutesAsDuration(cutoff) })
              : t("info.policy.cancelAnytime")}
          </p>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        <a
          href={bookingHomePath(slug)}
          className="mx-auto flex min-h-14 w-full max-w-md items-center justify-center rounded-xl text-base font-semibold text-white active:opacity-80"
          style={{ backgroundColor: "var(--brand-primary)" }}
        >
          {t("info.action.book")}
        </a>
      </div>
    </div>
  );
}
