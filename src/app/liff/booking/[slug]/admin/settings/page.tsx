import { notFound } from "next/navigation";
import OwnerSettings from "./owner-settings";
import { loadTenantBySlug } from "@/lib/tenants/load";
import { isTenantSlug } from "@/lib/tenants/slug";

/**
 * 店家設定 — the owner edits services, stylists, hours, days off and contact
 * details. Under /liff/booking/{slug} like every LIFF page (CLAUDE.md, Layout).
 *
 * The server renders only the shell. Everything editable is fetched by the
 * client through POST /api/admin/settings, after the ID token is verified, so
 * hidden services and stylists never reach a non-admin's browser.
 */

export const dynamic = "force-dynamic";

export default async function OwnerSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isTenantSlug(slug)) notFound();

  const loaded = await loadTenantBySlug(slug);
  if (!loaded) notFound();

  return (
    <OwnerSettings
      tenantName={loaded.tenant.name}
      brandPrimary={loaded.tenant.brand.primary}
      tenantSlug={slug}
      liffId={loaded.liffId ?? undefined}
    />
  );
}
