import { notFound } from "next/navigation";
import BookingFlow from "@/components/booking/booking-flow";
import { loadTenantBySlug } from "@/lib/tenants/load";

/**
 * Renders the booking flow from DATABASE rows, not from tenant config.
 *
 * This page must never import config/tenants/*. The UI's service and staff ids
 * have to be the ids the API routes look up, and the only way to guarantee that
 * is for both to come from the same place. They previously did not, and every
 * availability request returned 400.
 *
 * The slug is hardcoded until tenants are resolved from the route. That is the
 * ONE remaining piece of tenant identity in code, and swapping it for a route
 * segment is all that stands between this and true multi-tenancy.
 */

const TENANT_SLUG = "demo";

// Reads per request: tenant data changes without a redeploy, and the build must
// not try to reach the database.
export const dynamic = "force-dynamic";

export default async function BookingPage() {
  const loaded = await loadTenantBySlug(TENANT_SLUG);
  if (!loaded) notFound();

  return (
    <BookingFlow
      tenant={loaded.tenant}
      tenantSlug={TENANT_SLUG}
      // From tenants.liff_id, so each salon boots its own LIFF app. The env var
      // is only a fallback while a tenant row may not have one set yet.
      liffId={loaded.liffId ?? process.env.NEXT_PUBLIC_LIFF_ID}
    />
  );
}
