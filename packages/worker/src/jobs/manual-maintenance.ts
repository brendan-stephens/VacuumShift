import type { SupabaseClient } from '@supabase/supabase-js';
import { maintenanceConnectionVaultId } from '../connection-vault.js';
import { connectionStringForHostRunner } from '../connection-string.js';
import { runMaintenancePhase } from '../maintenance/run-maintenance.js';
import { getConnectionString } from '../vault.js';
import { loadDatabasePreferences } from './load-preferences.js';
import { runCheckPhase } from './run-check-phase.js';
import type { MaintenanceJobRow, MonitoredDatabaseRow } from '../types.js';

export async function runManualMaintenanceJob(
  supabase: SupabaseClient,
  job: MaintenanceJobRow,
  database: MonitoredDatabaseRow
): Promise<void> {
  const prefs = await loadDatabasePreferences(supabase, database.id);
  const windowEndsAt = new Date(job.window_ends_at);
  const stored = await getConnectionString(maintenanceConnectionVaultId(database));
  const connectionString = connectionStringForHostRunner(stored);

  const result = await runMaintenancePhase(
    supabase,
    job.id,
    database.id,
    connectionString,
    prefs,
    windowEndsAt
  );

  try {
    await runCheckPhase(
      supabase,
      database.id,
      database.connection_vault_id,
      prefs,
      'post_job'
    );
  } catch (err) {
    console.warn(
      '[manual-maintenance] post-check failed:',
      err instanceof Error ? err.message : err
    );
  }

  const finishedAt = new Date().toISOString();
  await supabase
    .from('maintenance_jobs')
    .update({
      status: result.status,
      finished_at: finishedAt,
      objects_queued: result.queued,
      objects_completed: result.completed,
      cleanup_rate_pages_per_sec: result.cleanupRatePagesPerSec,
      estimated_objects_completable: result.estimatedObjectsCompletable,
      error_message: result.errorMessage,
    })
    .eq('id', job.id);
}

export async function failMaintenanceJob(
  supabase: SupabaseClient,
  jobId: string,
  message: string
): Promise<void> {
  await supabase
    .from('maintenance_jobs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: message.slice(0, 2000),
    })
    .eq('id', jobId);
}
