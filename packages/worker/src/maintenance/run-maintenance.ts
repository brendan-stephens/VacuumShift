import pg, { type PoolClient } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BloatCandidate, DatabasePreferences } from '@vacuumshift/shared';
import {
  cleanupRatePagesPerSec,
  estimateCompletableInWindow,
} from '@vacuumshift/shared';
import { loadLatestBloatCandidates } from '../jobs/load-bloat-candidates.js';
import { REL_PAGES } from '../sql/measure-pages.js';
import {
  buildReindexSql,
  buildVacuumSql,
  filterCandidates,
  runOperation,
  shouldStartNextOperation,
  sleep,
} from './executor.js';

const { Client } = pg;

const DEFAULT_PLANNING_RATE = 32;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Stop the run only when the DB connection is gone — otherwise skip and continue. */
function isConnectionFatal(err: unknown): boolean {
  const message = errorMessage(err);
  return /connection terminated|ECONNRESET|ECONNREFUSED|connection refused|not connected|server closed the connection/i.test(
    message
  );
}

export interface MaintenanceRunResult {
  completed: number;
  queued: number;
  status: 'completed' | 'partial';
  cleanupRatePagesPerSec: number | null;
  estimatedObjectsCompletable: number;
  estimatedPagesCompletable: number;
  errorMessage: string | null;
}

function buildSql(candidate: BloatCandidate, prefs: DatabasePreferences): string {
  if (candidate.kind === 'table') {
    return buildVacuumSql(candidate.schemaName, candidate.objectName, prefs.tableVacuumMode);
  }
  return buildReindexSql(candidate.schemaName, candidate.objectName, prefs.indexReindexMode);
}

function operationLabel(candidate: BloatCandidate, prefs: DatabasePreferences): string {
  return candidate.kind === 'table' ? prefs.tableVacuumMode : prefs.indexReindexMode;
}

async function measureRelPages(
  client: pg.Client,
  schema: string,
  object: string
): Promise<number> {
  const result = await client.query<{ relpages: string | number }>(REL_PAGES, [schema, object]);
  const row = result.rows[0];
  if (!row) return 0;
  return typeof row.relpages === 'number' ? row.relpages : Number(row.relpages);
}

function rollingRate(samples: number[]): number | null {
  const valid = samples.filter((r) => r > 0);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function updateJobEstimates(
  candidates: BloatCandidate[],
  windowEndsAt: Date,
  rate: number | null,
  now: Date
): { estimatedObjectsCompletable: number; estimatedPagesCompletable: number } {
  const remainingMs = Math.max(0, windowEndsAt.getTime() - now.getTime());
  const effectiveRate = rate && rate > 0 ? rate : DEFAULT_PLANNING_RATE;
  const est = estimateCompletableInWindow(candidates, remainingMs, effectiveRate);
  return {
    estimatedObjectsCompletable: est.objects,
    estimatedPagesCompletable: est.pages,
  };
}

export async function runMaintenancePhase(
  supabase: SupabaseClient,
  jobId: string,
  databaseId: string,
  connectionString: string,
  prefs: DatabasePreferences,
  windowEndsAt: Date,
  options?: { candidates?: BloatCandidate[] }
): Promise<MaintenanceRunResult> {
  const rawCandidates =
    options?.candidates ??
    (await loadLatestBloatCandidates(supabase, databaseId)).candidates;
  const candidates = filterCandidates(rawCandidates, prefs);
  const now = new Date();

  let planningRate: number | null = null;
  const { estimatedObjectsCompletable, estimatedPagesCompletable } = updateJobEstimates(
    candidates,
    windowEndsAt,
    planningRate,
    now
  );

  await supabase
    .from('maintenance_jobs')
    .update({
      objects_queued: candidates.length,
      estimated_objects_completable: estimatedObjectsCompletable,
      estimated_pages_completable: estimatedPagesCompletable,
    })
    .eq('id', jobId);

  if (!candidates.length) {
    return {
      completed: 0,
      queued: 0,
      status: 'completed',
      cleanupRatePagesPerSec: null,
      estimatedObjectsCompletable: 0,
      estimatedPagesCompletable: 0,
      errorMessage: null,
    };
  }

  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();

  const rateSamples: number[] = [];
  let completed = 0;
  let failed = 0;
  let sortOrder = 0;
  const failureSamples: string[] = [];
  let stoppedEarly = false;

  try {
    for (const candidate of candidates) {
      if (!shouldStartNextOperation(windowEndsAt)) {
        stoppedEarly = true;
        break;
      }

      const sql = buildSql(candidate, prefs);
      const startedAt = new Date();
      let pagesBefore = candidate.bloatPages ?? 0;
      try {
        pagesBefore =
          candidate.bloatPages ??
          (await measureRelPages(client, candidate.schemaName, candidate.objectName));
      } catch {
        /* use estimate from check snapshot */
      }

      const { data: opRow, error: opInsertError } = await supabase
        .from('maintenance_operations')
        .insert({
          job_id: jobId,
          kind: candidate.kind,
          schema_name: candidate.schemaName,
          object_name: candidate.objectName,
          operation: operationLabel(candidate, prefs),
          status: 'running',
          bloat_bytes_before: candidate.bloatBytes,
          bloat_pages_before: pagesBefore,
          started_at: startedAt.toISOString(),
          sort_order: sortOrder++,
        })
        .select('id')
        .single();

      if (opInsertError) throw opInsertError;
      const opId = opRow.id as string;

      try {
        await runOperation(client as unknown as PoolClient, sql, prefs, windowEndsAt);
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();
        const pagesAfter = await measureRelPages(
          client,
          candidate.schemaName,
          candidate.objectName
        );
        const pagesReclaimed = Math.max(0, pagesBefore - pagesAfter);
        const opRate = cleanupRatePagesPerSec(pagesBefore, pagesAfter, durationMs);
        if (opRate != null && opRate > 0) rateSamples.push(opRate);

        planningRate = rollingRate(rateSamples);
        const est = updateJobEstimates(
          candidates.slice(completed + 1),
          windowEndsAt,
          planningRate,
          finishedAt
        );

        await supabase
          .from('maintenance_operations')
          .update({
            status: 'completed',
            finished_at: finishedAt.toISOString(),
            duration_ms: durationMs,
            bloat_pages_after: pagesAfter,
            pages_reclaimed: pagesReclaimed,
            cleanup_rate_pages_per_sec: opRate,
          })
          .eq('id', opId);

        completed += 1;
        await supabase
          .from('maintenance_jobs')
          .update({
            objects_completed: completed,
            cleanup_rate_pages_per_sec: planningRate,
            estimated_objects_completable: completed + est.estimatedObjectsCompletable,
            estimated_pages_completable: est.estimatedPagesCompletable,
          })
          .eq('id', jobId);
      } catch (err) {
        const message = errorMessage(err);
        await supabase
          .from('maintenance_operations')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            error_message: message.slice(0, 2000),
          })
          .eq('id', opId);

        if (isConnectionFatal(err)) {
          failed += 1;
          const label = `${candidate.schemaName}.${candidate.objectName}`;
          if (failureSamples.length < 5) {
            failureSamples.push(`${label}: ${message}`);
          }
          break;
        }

        failed += 1;
        const label = `${candidate.schemaName}.${candidate.objectName}`;
        if (failureSamples.length < 5) {
          failureSamples.push(`${label}: ${message}`);
        }
        continue;
      }

      if (prefs.pauseBetweenOpsMs > 0) {
        await sleep(prefs.pauseBetweenOpsMs);
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  const finalRate = rollingRate(rateSamples);
  const status: 'completed' | 'partial' =
    completed >= candidates.length && failed === 0
      ? 'completed'
      : completed > 0 || failed > 0
        ? 'partial'
        : 'partial';

  let jobErrorMessage: string | null = null;
  if (completed < candidates.length || failed > 0) {
    const parts = [`Completed ${completed} of ${candidates.length} objects.`];
    if (failed > 0) {
      parts.push(`${failed} failed (skipped, continued with remaining objects).`);
      if (failureSamples.length) {
        parts.push(failureSamples.join('; '));
      }
      if (failureSamples.some((s) => /permission denied/i.test(s))) {
        parts.push(
          'Use a postgres maintenance connection (database page → Maintenance connection) for REINDEX/VACUUM on Postgres 15/16.'
        );
      }
    }
    if (stoppedEarly) {
      parts.push('Stopped when the maintenance window ended.');
    }
    jobErrorMessage = parts.join(' ');
  }

  return {
    completed,
    queued: candidates.length,
    status,
    cleanupRatePagesPerSec: finalRate,
    estimatedObjectsCompletable: completed,
    estimatedPagesCompletable: 0,
    errorMessage: jobErrorMessage,
  };
}
