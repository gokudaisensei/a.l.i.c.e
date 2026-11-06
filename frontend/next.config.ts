import type { NextConfig } from "next";

/** Where the Alice backend runs. The browser only ever talks to this app: `/api/*` is proxied, so the session cookie is first-party. */
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // The end-to-end tests build into their own folder so they can run beside the dev server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  rewrites: async () => [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }],
  /* config options here */
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
