import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is served under vote.example.com via a rewrite (SPEC 4.0, 8.2).
  // Inlined at build time — client fetch/img/audio paths go through withBase().
  basePath: "",
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Nominee photos never change once generated
        source: "/nominees/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
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
