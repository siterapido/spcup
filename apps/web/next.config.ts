import path from "node:path";
import type { NextConfig } from "next";

/** Monorepo root — Vercel installs from repo root; trace must resolve pnpm hoisted deps. */
const tracingRoot = path.join(__dirname, "../..");

const canvasTraceGlobs = [
  "node_modules/@napi-rs/canvas/**/*",
  "node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
];

const nextConfig: NextConfig = {
  transpilePackages: ["@spc-up/core", "@spc-up/db", "@spc-up/spca"],
  outputFileTracingRoot: tracingRoot,
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/prestacao/**/*": canvasTraceGlobs,
    "/api/upload": canvasTraceGlobs,
  },
};

export default nextConfig;
