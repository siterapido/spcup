import path from "node:path";
import type { NextConfig } from "next";

/** Monorepo root — Vercel installs from repo root; trace must resolve pnpm hoisted deps. */
const tracingRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  transpilePackages: ["@spc-up/core", "@spc-up/db", "@spc-up/spca", "pdfjs-dist"],
  outputFileTracingRoot: tracingRoot,
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
};

export default nextConfig;
