import type { NextConfig } from "next";

/** Where the Alice backend runs. The browser only ever talks to this app: `/api/*` and the `/ws` socket are proxied, so the session cookie is first-party and a reverse proxy only needs to reach this one port. */
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // The end-to-end tests build into their own folder so they can run beside the dev server.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  rewrites: async () => [
    { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
    { source: "/ws", destination: `${BACKEND}/ws` },
  ],
  /* config options here */
  // Dev server behind a reverse proxy: let the public hostname load /_next resources (set by ./setup.sh --public-url).
  allowedDevOrigins: process.env.PUBLIC_HOST ? [process.env.PUBLIC_HOST] : [],
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
