import { notFound } from "next/navigation";
import MyBookings from "./my-bookings";
import { loadTenantBySlug } from "@/lib/tenants/load";
import { isTenantSlug } from "@/lib/tenants/slug";

/**
 * The customer's own bookings, with cancellation.
 *
 * Lives UNDER /liff/booking/{slug} because that is the LIFF app's registered
 * endpoint and liff.init() only runs at or below it. Its LIFF URL is therefore
 * https://liff.line.me/{liffId}/mine — the link the rich menu and the pushed
 * cards use.
 */

export const dynamic = "force-dynamic";

export default async function MyBookingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isTenantSlug(slug)) notFound();

  const loaded = await loadTenantBySlug(slug);
  if (!loaded) notFound();

  return (
    <MyBookings
      tenantName={loaded.tenant.name}
      brandPrimary={loaded.tenant.brand.primary}
      tenantSlug={slug}
      liffId={loaded.liffId ?? undefined}
    />
  );
}
