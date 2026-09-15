import { notFound } from "next/navigation";
import AdminSchedule from "./admin-schedule";
import { loadTenantBySlug } from "@/lib/tenants/load";

/**
 * Salon-owner schedule.
 *
 * Lives UNDER /liff/booking because that is the LIFF app's registered endpoint,
 * and liff.init() only runs at or below it. A sibling route is rejected by LINE
 * with a bare 400 on every device — see the note on the diagnostics page.
 */

const TENANT_SLUG = "demo";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const loaded = await loadTenantBySlug(TENANT_SLUG);
  if (!loaded) notFound();

  return (
    <AdminSchedule
      tenantName={loaded.tenant.name}
      brandPrimary={loaded.tenant.brand.primary}
      tenantSlug={TENANT_SLUG}
      liffId={loaded.liffId ?? process.env.NEXT_PUBLIC_LIFF_ID}
    />
  );
}
