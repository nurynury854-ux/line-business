/**
 * Initialises LIFF once per page load.
 *
 * liff.init() is not idempotent, and React re-renders (and StrictMode) would
 * otherwise call it repeatedly, so the promise is cached at module scope. A
 * failure is NOT cached: a retry must be able to try again.
 *
 * Every LIFF page uses this rather than its own copy, so the behaviour above is
 * fixed in one place.
 */

type Liff = typeof import("@line/liff").default;

let liffPromise: Promise<Liff> | null = null;

export function loadLiff(liffId: string): Promise<Liff> {
  if (!liffPromise) {
    liffPromise = (async () => {
      const liff = (await import("@line/liff")).default;
      await liff.init({ liffId });
      return liff;
    })().catch((error) => {
      liffPromise = null;
      throw error;
    });
  }
  return liffPromise;
}
