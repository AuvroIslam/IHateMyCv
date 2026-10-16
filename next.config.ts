import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Lets a second, isolated instance (e.g. a test server with its own
  // CV_DATA_DIR) run beside the main one without sharing build output.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
