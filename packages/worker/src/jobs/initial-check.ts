import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDatabasePreferences } from './load-preferences.js';
import { runCheckPhase } from './run-check-phase.js';
import type { MaintenanceJobRow, MonitoredDatabaseRow } from '../types.js';

export async function runInitialCheckJob(
  supabase: SupabaseClient,
  job: MaintenanceJobRow,
  database: MonitoredDatabaseRow
): Promise<void> {
  const prefs = await loadDatabasePreferences(supabase, database.id);
  const checkStats = await runCheckPhase(
    supabase,
    database.id,
    database.connection_vault_id,
    prefs,
    'check'
  );

  const finishedAt = new Date().toISOString();
  const { error: jobError } = await supabase
    .from('maintenance_jobs')
    .update({
      status: 'completed',
      finished_at: finishedAt,
      objects_queued: checkStats.objectCount,
      objects_completed: checkStats.objectCount,
      pages_before: checkStats.tableBloatPages + checkStats.indexBloatPages,
      pages_after: 0,
    })
    .eq('id', job.id);

  if (jobError) throw jobError;
}

export async function failJob(
  supabase: SupabaseClient,
  jobId: string,
  databaseId: string,
  message: string
): Promise<void> {
  const finishedAt = new Date().toISOString();
  await supabase
    .from('maintenance_jobs')
    .update({
      status: 'failed',
      finished_at: finishedAt,
      error_message: message.slice(0, 2000),
    })
    .eq('id', jobId);

  await supabase
    .from('monitored_databases')
    .update({
      last_health_at: finishedAt,
      last_health_ok: false,
      last_health_error: message.slice(0, 2000),
    })
    .eq('id', databaseId);
}
