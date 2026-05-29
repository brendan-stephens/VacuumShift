import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Worker uses secret key only (`sb_secret_...`), never legacy service_role JWT.
 */
export function createWorkerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  }
  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
