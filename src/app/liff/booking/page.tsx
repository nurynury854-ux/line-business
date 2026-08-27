import LiffDiagnostics from "./liff-diagnostics";

// Server component. All LIFF work happens inside LiffDiagnostics, which is a
// client component that imports the SDK only after mount.
export default function BookingPage() {
  return <LiffDiagnostics />;
}
