import Link from "next/link";
import { dalaTech } from "@config/agency/offerings";
import { t } from "@/i18n";

/**
 * DalaTech's own sales page, linked from the 價目表 button on the agency's LINE
 * rich menu. The audience is a salon owner deciding whether to buy.
 *
 * NOT part of the multi-tenant product. It reads config/agency/offerings.ts and
 * never touches a tenant, a database or LINE identity — which is why it is a
 * plain route rather than a LIFF page, and why it needs no login. That also
 * means it opens fine on a laptop, unlike anything under /liff.
 *
 * Rendered mostly inside LINE's in-app browser at ~375px, so the same
 * constraints as the booking flow apply (CLAUDE.md §6).
 */

export const metadata = {
  title: `${dalaTech.name}｜${t("agency.plans.title")}`,
  description: dalaTech.tagline,
};

export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-black/[0.02]">
      <header className="mx-auto w-full max-w-md px-4 pt-8 pb-5">
        <p className="text-sm font-semibold tracking-wide text-black/50">
          {dalaTech.name}
        </p>
        <h1 className="mt-1 text-2xl font-bold leading-snug">
          {t("agency.plans.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-black/65">
          {dalaTech.tagline}
        </p>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-10">
        <ul className="flex flex-col gap-3">
          {dalaTech.offerings.map((offering) => (
            <li
              key={offering.id}
              className="rounded-2xl border bg-white p-4"
              style={{
                borderColor: offering.highlighted ? "#1f5f4e" : "rgba(0,0,0,0.1)",
                borderWidth: offering.highlighted ? 2 : 1,
              }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold">{offering.name}</h2>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold" style={{ color: "#1f5f4e" }}>
                    {offering.priceLabel}
                  </p>
                </div>
              </div>

              <p className="mt-1 text-xs leading-relaxed text-black/60">
                {offering.tagline}
              </p>

              {offering.priceNote && (
                <p className="mt-1 text-[11px] text-black/45">{offering.priceNote}</p>
              )}

              <p className="mt-3 mb-1.5 text-[11px] font-medium tracking-wide text-black/45">
                {t("agency.plans.includes")}
              </p>
              <ul className="flex flex-col gap-1.5">
                {offering.includes.map((item) => (
                  <li key={item} className="flex gap-2 text-xs leading-relaxed text-black/75">
                    <span aria-hidden style={{ color: "#1f5f4e" }}>
                      ✓
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {/* The demo is the strongest argument on this page, so it sits between
            the plans and the contact button rather than buried at the bottom. */}
        <section className="mt-5 rounded-2xl border border-black/10 bg-white p-4 text-center">
          <p className="text-sm text-black/65">{t("agency.plans.demoLead")}</p>
          <Link
            href="/liff/booking"
            className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border-2 text-sm font-semibold active:opacity-80"
            style={{ borderColor: "#1f5f4e", color: "#1f5f4e" }}
          >
            {t("agency.plans.demo")}
          </Link>
        </section>

        {dalaTech.faq.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold">{t("agency.plans.faq")}</h2>
            <ul className="flex flex-col gap-2">
              {dalaTech.faq.map((entry) => (
                <li key={entry.question} className="rounded-xl border border-black/10 bg-white p-3">
                  <p className="text-sm font-medium">{entry.question}</p>
                  <p className="mt-1 text-xs leading-relaxed text-black/65">{entry.answer}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-6 text-center text-[11px] leading-relaxed text-black/45">
          {t("agency.plans.footer")}
        </p>

        <a
          href={dalaTech.contactUrl}
          className="mt-3 flex min-h-14 w-full items-center justify-center rounded-xl text-base font-semibold text-white active:opacity-80"
          style={{ backgroundColor: "#1f5f4e" }}
        >
          {t("agency.plans.contact")}
        </a>
      </main>
    </div>
  );
}
