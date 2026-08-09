import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Only use static export in production builds
  output: process.env.NODE_ENV === 'production' ? 'export' : undefined,
  images: {
    unoptimized: true,
  },
  // Proxy API requests to backend during local development
  async rewrites() {
    return [
      {
        source: '/health/:path*',
        destination: 'http://localhost:5000/health/:path*',
      },
      {
        source: '/api/:path*',
        destination: 'http://localhost:5000/api/:path*',
      },
    ];
  }
};

export default nextConfig;
