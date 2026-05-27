import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@spc-up/core", "@spc-up/db", "@spc-up/spca"],
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
};

export default nextConfig;
