import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@spc-up/core", "@spc-up/db", "@spc-up/spca"],
};

export default nextConfig;
