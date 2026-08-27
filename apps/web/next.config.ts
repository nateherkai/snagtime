import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  generateBuildId: async () => process.env.BUILD_ID && /^[a-f0-9]{40,64}$/i.test(process.env.BUILD_ID) ? process.env.BUILD_ID : null,
  env: { TEMPOCOVE_COMPILED_BUILD_ID: process.env.BUILD_ID || "development" },
  poweredByHeader: false,
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};

export default nextConfig;
