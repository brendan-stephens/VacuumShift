import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Load repo-root .env.local so one file feeds web + worker + functions
loadEnvConfig(path.join(__dirname, '../..'));

const nextConfig: NextConfig = {
  transpilePackages: ['@vacuumshift/shared'],
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL ?? '',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
  },
};

export default nextConfig;
