import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Keep production builds out of the dev server's folder so `npm run build` never breaks a running `npm run dev`.
  // Vercel expects the default .next; locally, builds go to .next-build so they do not clash with the dev server.
  distDir: process.env.VERCEL ? ".next" : process.env.NEXT_DIST_DIR ?? ".next",
  // The version shown in the demo menu.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version },
  // No Next.js dev badge: it covers the account row in local demos.
  devIndicators: false,
  // The FAQ and demo guide are read from disk at request time, so ship them with the agent route on Vercel.
  outputFileTracingIncludes: { "/api/agent": ["./src/knowledge/**/*.md"] },
};

export default nextConfig;
