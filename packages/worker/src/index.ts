import './dns.js';
import './config.js';
import { config } from './config.js';
import { createWorkerClient } from './supabase.js';
import { processJobBatch } from './poll.js';
import { closeVaultPool } from './vault.js';

const supabase = createWorkerClient();

let stopping = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;

async function tick(): Promise<void> {
  if (stopping) return;
  try {
    const processed = await processJobBatch(supabase, config.jobBatchSize);
    if (processed > 0) {
      console.log(`[worker] processed ${processed} job(s)`);
    }
  } catch (err) {
    console.error('[worker] poll error:', err);
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} — shutting down…`);
  if (pollTimer) clearInterval(pollTimer);
  await closeVaultPool();
  process.exit(0);
}

async function main(): Promise<void> {
  console.log('[worker] VacuumShift worker started');
  console.log(`[worker] poll interval ${config.pollIntervalMs}ms`);
  console.log('[worker] stop: Ctrl+C or npm run stop:worker');

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await tick();
  pollTimer = setInterval(() => void tick(), config.pollIntervalMs);
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
