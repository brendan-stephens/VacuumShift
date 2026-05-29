import './dns.js';
import './config.js';
import { createWorkerClient } from './supabase.js';
import { processJobBatch } from './poll.js';
import { closeVaultPool } from './vault.js';

const supabase = createWorkerClient();
const n = await processJobBatch(supabase, 10);
console.log(`[worker] one-shot finished, processed ${n} job(s)`);
await closeVaultPool();
