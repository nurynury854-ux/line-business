import { notFound } from "next/navigation";
import MyBookings from "./my-bookings";
import { loadTenantBySlug } from "@/lib/tenants/load";

/**
 * The customer's own bookings, with cancellation.
 *
 * Lives UNDER /liff/booking because that is the LIFF app's registered endpoint
 * and liff.init() only runs at or below it. Its LIFF URL is therefore
 * https://liff.line.me/{liffId}/mine — the link the rich menu and the pushed
 * cards use.
 */

const TENANT_SLUG = "demo";

export const dynamic = "force-dynamic";

export default async function MyBookingsPage() {
  const loaded = await loadTenantBySlug(TENANT_SLUG);
  if (!loaded) notFound();

  return (
    <MyBookings
      tenantName={loaded.tenant.name}
      brandPrimary={loaded.tenant.brand.primary}
      tenantSlug={TENANT_SLUG}
      liffId={loaded.liffId ?? process.env.NEXT_PUBLIC_LIFF_ID}
    />
  );
}
