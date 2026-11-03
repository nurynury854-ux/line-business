import { notFound } from "next/navigation";
import LiffDiagnostics from "./liff-diagnostics";
import { loadTenantBySlug } from "@/lib/tenants/load";
import { isTenantSlug } from "@/lib/tenants/slug";

/**
 * Lives UNDER /liff/booking/{slug} on purpose. That path is the LIFF app's
 * registered endpoint URL, and liff.init() only works on pages at or below it —
 * a sibling path such as /liff/diagnostics is rejected by LINE with a bare
 * "400 Bad Request" on every device, which is indistinguishable from a broken
 * deploy unless you know to look for it. Do not move this out from under the
 * endpoint.
 */

export const dynamic = "force-dynamic";

export default async function DiagnosticsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isTenantSlug(slug)) notFound();

  const loaded = await loadTenantBySlug(slug);
  if (!loaded) notFound();

  return <LiffDiagnostics liffId={loaded.liffId ?? undefined} />;
}
