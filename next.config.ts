import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // An unrelated package-lock.json in a parent directory makes Next infer the
  // wrong workspace root, which throws off build file tracing. Pin it here so
  // local and Vercel builds trace the same tree. `next build` always runs from
  // the project root in both environments.
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
