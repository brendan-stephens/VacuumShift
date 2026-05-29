import type { SupabaseClient } from '@supabase/supabase-js';
import { claimPendingInitialJobs } from './jobs/claim.js';
import { claimPendingManualJobs } from './jobs/claim-manual.js';
import { claimPendingScheduledJobs } from './jobs/claim-scheduled.js';
import { failJob, runInitialCheckJob } from './jobs/initial-check.js';
import { failMaintenanceJob, runManualMaintenanceJob } from './jobs/manual-maintenance.js';
import { runScheduledMaintenanceJob } from './jobs/scheduled-maintenance.js';
import { enqueueDueScheduledJobs } from './schedules/enqueue-due.js';

export async function processJobBatch(
  supabase: SupabaseClient,
  batchSize: number
): Promise<number> {
  let processed = 0;

  const enqueued = await enqueueDueScheduledJobs(supabase);
  if (enqueued > 0) {
    console.log(`[scheduler] enqueued ${enqueued} scheduled job(s)`);
  }

  const scheduledJobs = await claimPendingScheduledJobs(supabase, batchSize);
  if (scheduledJobs.length) {
    console.log(`[worker] claimed ${scheduledJobs.length} scheduled job(s)`);
  }
  for (const { job, database } of scheduledJobs) {
    try {
      await runScheduledMaintenanceJob(supabase, job, database);
      console.log(
        `[scheduled-maintenance] completed job=${job.id} database=${database.label} (${database.id})`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[scheduled-maintenance] failed job=${job.id} database=${database.id}: ${message}`
      );
      await failMaintenanceJob(supabase, job.id, message);
    }
    processed += 1;
  }

  const initialJobs = await claimPendingInitialJobs(supabase, batchSize);
  if (initialJobs.length) {
    console.log(`[worker] claimed ${initialJobs.length} initial job(s)`);
  }
  for (const { job, database } of initialJobs) {
    try {
      await runInitialCheckJob(supabase, job, database);
      console.log(
        `[initial-check] completed job=${job.id} database=${database.label} (${database.id})`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[initial-check] failed job=${job.id} database=${database.id}: ${message}`
      );
      await failJob(supabase, job.id, database.id, message);
    }
    processed += 1;
  }

  const manualJobs = await claimPendingManualJobs(supabase, batchSize);
  if (manualJobs.length) {
    console.log(`[worker] claimed ${manualJobs.length} manual maintenance job(s)`);
  }
  for (const { job, database } of manualJobs) {
    try {
      await runManualMaintenanceJob(supabase, job, database);
      console.log(
        `[manual-maintenance] completed job=${job.id} database=${database.label} (${database.id})`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[manual-maintenance] failed job=${job.id} database=${database.id}: ${message}`
      );
      await failMaintenanceJob(supabase, job.id, message);
    }
    processed += 1;
  }

  return processed;
}
