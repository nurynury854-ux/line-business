import { demoTenant } from "@config/tenants/demo";
import BookingFlow from "@/components/booking/booking-flow";

// The tenant is hardcoded to the demo salon for now. Once tenants are resolved
// from the route or the database, only this line changes — BookingFlow already
// takes the whole config as a prop (CLAUDE.md §5).
export default function BookingPage() {
  return <BookingFlow tenant={demoTenant} />;
}
