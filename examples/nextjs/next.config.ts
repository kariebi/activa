import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@activaq/sdk'],
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  experimental: {
    useWasmBinary: true
  }
};

export default nextConfig;
