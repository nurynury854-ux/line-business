import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // An unrelated package-lock.json in a parent directory makes Next infer the
  // wrong workspace root, which throws off build file tracing. Pin it here so
  // local and Vercel builds trace the same tree. `next build` always runs from
  // the project root in both environments.
  outputFileTracingRoot: process.cwd(),

  // TRANSITIONAL. Before tenants moved into the route, the demo's LIFF app was
  // registered with endpoint /liff/booking. Until its endpoint is changed to
  // /liff/booking/demo in the LINE Developers console, LIFF still opens these
  // paths. The targets sit below the old endpoint, so liff.init() accepts them,
  // and Next keeps the query string, so `liff.state` survives the hop.
  //
  // Remove once the demo's endpoint is updated. No other tenant ever used them.
  async redirects() {
    return [
      { source: "/liff/booking", destination: "/liff/booking/demo", permanent: false },
      {
        source: "/liff/booking/:page(mine|info|admin|diagnostics)",
        destination: "/liff/booking/demo/:page",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
