import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@midscene/web", "@midscene/core", "@midscene/shared", "playwright", "playwright-core", "@libsql/client", "libsql", "unpdf"],
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
