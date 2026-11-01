import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optional sub-path (e.g. "/vote"). Inlined at build time — client fetch/audio paths go through withBase().
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        // CSS modules (stage.module.css) stay with Next's own loader so class names get scoped
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
