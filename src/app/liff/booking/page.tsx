import { demoTenant } from "@config/tenants/demo";
import BookingFlow from "@/components/booking/booking-flow";

/**
 * The tenant is still the hardcoded demo config. Once tenants are resolved from
 * the route, this becomes a lookup and BookingFlow needs no change — it already
 * takes the whole config as a prop (CLAUDE.md §5).
 *
 * liffId comes from the environment for now. With one LIFF app per salon it is
 * tenant data, so the real source is tenants.liff_id — which this page will read
 * once it resolves the tenant from the database.
 */
export default function BookingPage() {
  return (
    <BookingFlow
      tenant={demoTenant}
      tenantSlug="demo"
      liffId={process.env.NEXT_PUBLIC_LIFF_ID}
    />
  );
}
