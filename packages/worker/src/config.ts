import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnvFile(resolve(root, '.env.local'));
loadEnvFile(resolve(root, '.env'));

export const config = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseSecretKey: required('SUPABASE_SECRET_KEY'),
  /** Direct Postgres URL to the Supabase project DB (for Vault reads). */
  supabaseDbUrl:
    process.env.SUPABASE_DB_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5_000),
  jobBatchSize: Number(process.env.WORKER_JOB_BATCH_SIZE ?? 4),
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}
