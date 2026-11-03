import { notFound } from "next/navigation";
import AdminSchedule, { type Range } from "./admin-schedule";
import { loadTenantBySlug } from "@/lib/tenants/load";
import { isTenantSlug } from "@/lib/tenants/slug";

/**
 * Salon-owner schedule.
 *
 * Lives UNDER /liff/booking/{slug} because that is the LIFF app's registered
 * endpoint, and liff.init() only runs at or below it. A sibling route is
 * rejected by LINE with a bare 400 on every device — see the note on the
 * diagnostics page.
 */

export const dynamic = "force-dynamic";

export default async function AdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { slug } = await params;
  // ?range=attention is how the settings page links straight to the bookings a
  // change has just affected.
  const initialRange: Range = (await searchParams).range === "attention" ? "attention" : "today";
  if (!isTenantSlug(slug)) notFound();

  const loaded = await loadTenantBySlug(slug);
  if (!loaded) notFound();

  return (
    <AdminSchedule
      tenantName={loaded.tenant.name}
      brandPrimary={loaded.tenant.brand.primary}
      tenantSlug={slug}
      liffId={loaded.liffId ?? undefined}
      initialRange={initialRange}
    />
  );
}
