import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // The sandbox's sharp image optimizer hard-hangs on some resize operations
  // and deadlocks the whole dev server (observed on /_next/image w=256).
  // The only optimized asset is the small local logo — unoptimized is safe
  // and removes the hang entirely.
  images: { unoptimized: true },
};

export default nextConfig;
