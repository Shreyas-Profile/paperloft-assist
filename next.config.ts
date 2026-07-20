import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker/Node runtime on Hetzner (was Lambda-via-OpenNext + CloudFront before).
  output: "standalone",
  experimental: {
    serverActions: {
      // All public hostnames the Cloudflare tunnel routes to this container.
      // middleware.ts 308-redirects the aliases to paperloft.uk, but Server
      // Actions submitted during the redirect hop need the origin whitelisted
      // or Next.js rejects them.
      allowedOrigins: [
        "paperloft.uk",
        "www.paperloft.uk",
        "paperloft.regiq.in",
      ],
    },
  },
};

export default nextConfig;
