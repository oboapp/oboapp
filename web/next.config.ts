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

// withSentryConfig is a build-time concern (source map uploads).
// Runtime error capture works via sentry.*.config.ts regardless of this wrapper.
// Gate on SENTRY_AUTH_TOKEN so local dev with only a DSN gets a vanilla build.
export default process.env.SENTRY_AUTH_TOKEN
  ? withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: !process.env.CI,
      disableLogger: true,
    })
  : config;
