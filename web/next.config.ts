import type { NextConfig } from "next";
import createMDX from "@next/mdx";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  transpilePackages: ["@oboapp/shared"],
  serverExternalPackages: ["lightningcss"],
  experimental: {
    externalDir: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "api.dicebear.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
  // 308 redirect /api/v1/* → api.oboapp.online/v1/* (issue #259)
  async redirects() {
    const apiHost = process.env.PUBLIC_API_HOST?.replace(/\/+$/, "");
    if (!apiHost) return [];
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiHost}/v1/:path*`,
        permanent: true,
      },
    ];
  },
  // Production optimizations
  compiler: {
    // Remove debug console logs in production, keep error/warn for monitoring
    removeConsole:
      process.env.NODE_ENV === "production"
        ? {
            exclude: ["error", "warn"],
          }
        : false,
  },
};

const withMDX = createMDX({
  // Add markdown plugins here, as desired
});

const config = withMDX(nextConfig);

// Always apply withSentryConfig so the client bundle is correctly instrumented
// (sentry.client.config.ts is injected by the wrapper, not loaded automatically).
// Source map uploads only happen in CI when SENTRY_AUTH_TOKEN is present.
export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  disableLogger: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
