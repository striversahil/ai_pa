import type { NextConfig } from "next";

// Static export for Cloudflare Pages; dev-server rewrites for local work.
// `output` must never be an accidental no-op: a build that ran outside a
// production NODE_ENV skipped the export and left the PREVIOUS out/ behind
// for `wrangler pages deploy out` to upload — that is how production ended
// up serving two webpack runtimes and a 404.html (app-wide 404 on refresh).
const isExport = process.env.NEXT_OUTPUT === 'export' || process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  ...(isExport ? { output: 'export' as const } : {}),
  images: {
    unoptimized: true,
  },
  // Rewrites are unsupported in a static export — dev only.
  ...(isExport
    ? {}
    : {
        async rewrites() {
          return [
            { source: '/health/:path*', destination: 'http://localhost:5000/health/:path*' },
            { source: '/api/:path*', destination: 'http://localhost:5000/api/:path*' },
          ];
        },
      }),
};

export default nextConfig;
