import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaintenanceJobRow, MonitoredDatabaseRow } from '../types.js';

export interface ClaimedInitialJob {
  job: MaintenanceJobRow;
  database: MonitoredDatabaseRow;
}

export async function claimPendingInitialJobs(
  supabase: SupabaseClient,
  limit: number
): Promise<ClaimedInitialJob[]> {
  const { data: pending, error: listError } = await supabase
    .from('maintenance_jobs')
    .select('id, database_id, kind, status, window_started_at, window_ends_at')
    .eq('status', 'pending')
    .eq('kind', 'initial')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (listError) {
    console.error('[worker] list pending jobs failed:', listError.message);
    throw listError;
  }
  if (!pending?.length) return [];
  console.log(`[worker] found ${pending.length} pending initial job(s)`);

  const claimed: ClaimedInitialJob[] = [];

  for (const row of pending) {
    const startedAt = new Date().toISOString();
    const { data: job, error: claimError } = await supabase
      .from('maintenance_jobs')
      .update({ status: 'running', started_at: startedAt })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id, database_id, kind, status, window_started_at, window_ends_at')
      .maybeSingle();

    if (claimError) throw claimError;
    if (!job) continue;

    const { data: database, error: dbError } = await supabase
      .from('monitored_databases')
      .select('id, label, connection_vault_id, maintenance_connection_vault_id, paused')
      .eq('id', job.database_id)
      .single();

    if (dbError || !database) {
      await supabase
        .from('maintenance_jobs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: 'Monitored database not found',
        })
        .eq('id', job.id);
      continue;
    }

    if (database.paused) {
      await supabase
        .from('maintenance_jobs')
        .update({
          status: 'cancelled',
          finished_at: new Date().toISOString(),
          error_message: 'Database is paused',
        })
        .eq('id', job.id);
      continue;
    }

    claimed.push({
      job: job as MaintenanceJobRow,
      database: database as MonitoredDatabaseRow,
    });
  }

  return claimed;
}
