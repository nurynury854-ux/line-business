import { notFound } from "next/navigation";
import BookingFlow from "@/components/booking/booking-flow";
import { loadTenantBySlug } from "@/lib/tenants/load";
import { isTenantSlug } from "@/lib/tenants/slug";

/**
 * Renders the booking flow from DATABASE rows, not from tenant config.
 *
 * This page must never import config/tenants/*. The UI's service and staff ids
 * have to be the ids the API routes look up, and the only way to guarantee that
 * is for both to come from the same place. They previously did not, and every
 * availability request returned 400.
 *
 * The tenant comes from the route: /liff/booking/{slug} is the endpoint URL of
 * that salon's LIFF app, and every page below it inherits the same slug.
 */

// Reads per request: tenant data changes without a redeploy, and the build must
// not try to reach the database.
export const dynamic = "force-dynamic";

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isTenantSlug(slug)) notFound();

  const loaded = await loadTenantBySlug(slug);
  if (!loaded) notFound();

  return (
    <BookingFlow
      tenant={loaded.tenant}
      tenantSlug={slug}
      // From tenants.liff_id, so each salon boots its own LIFF app. No env
      // fallback: another salon's LIFF id cannot init at this salon's URL.
      liffId={loaded.liffId ?? undefined}
    />
  );
}
