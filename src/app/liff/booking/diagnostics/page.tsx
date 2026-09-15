import LiffDiagnostics from "./liff-diagnostics";

/**
 * Lives UNDER /liff/booking on purpose. That path is the LIFF app's registered
 * endpoint URL, and liff.init() only works on pages at or below it — a sibling
 * path such as /liff/diagnostics is rejected by LINE with a bare
 * "400 Bad Request" on every device, which is indistinguishable from a broken
 * deploy unless you know to look for it. Do not move this out from under the
 * endpoint.
 */
export default function DiagnosticsPage() {
  return <LiffDiagnostics />;
}
