import type { BloatCandidate, DatabasePreferences, IndexReindexMode, TableVacuumMode } from '@vacuumshift/shared';
import {
  canStartOperation,
  formatStatementTimeout,
  isObjectExcluded,
  operationStatementTimeoutMs,
} from '@vacuumshift/shared';
import type { PoolClient } from 'pg';

export function filterCandidates(
  objects: BloatCandidate[],
  prefs: DatabasePreferences
): BloatCandidate[] {
  const minBytes = (kind: BloatCandidate['kind']) =>
    (kind === 'table' ? prefs.minTableSizeMb : prefs.minIndexSizeMb) * 1024 * 1024;

  return objects
    .filter(
      (o) =>
        !isObjectExcluded(prefs.excludePatterns, {
          schemaName: o.schemaName,
          objectName: o.objectName,
          parentSchema: o.parentSchema,
          parentTable: o.parentTable,
        })
    )
    .filter((o) => o.relationBytes >= minBytes(o.kind))
    .sort((a, b) => b.bloatBytes - a.bloatBytes);
}

export function buildVacuumSql(schema: string, table: string, mode: TableVacuumMode): string {
  const q = `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
  return mode === 'vacuum_analyze' ? `vacuum analyze ${q}` : `vacuum ${q}`;
}

export function buildReindexSql(
  schema: string,
  index: string,
  mode: IndexReindexMode
): string {
  const q = `"${schema.replace(/"/g, '""')}"."${index.replace(/"/g, '""')}"`;
  return mode === 'reindex_concurrently'
    ? `reindex index concurrently ${q}`
    : `reindex index ${q}`;
}

/**
 * Apply statement_timeout before a maintenance statement.
 * - enforceTimeWindow off: SET statement_timeout = 0 (ignore role/system limits)
 * - enforceTimeWindow on: timeout = remaining window + 30s grace
 */
export async function applyOperationStatementTimeout(
  client: PoolClient,
  prefs: DatabasePreferences,
  windowEndsAt: Date,
  now: Date = new Date()
): Promise<void> {
  const ms = operationStatementTimeoutMs(prefs.enforceTimeWindow, windowEndsAt, now);
  await client.query(`SET statement_timeout = '${formatStatementTimeout(ms)}'`);
}

/** Default: only start a new op if still inside the window (no grace on start). */
export function shouldStartNextOperation(windowEndsAt: Date, now: Date = new Date()): boolean {
  return canStartOperation(windowEndsAt, now);
}

export async function runOperation(
  client: PoolClient,
  sql: string,
  prefs: DatabasePreferences,
  windowEndsAt: Date
): Promise<void> {
  await applyOperationStatementTimeout(client, prefs, windowEndsAt);
  await client.query(sql);
}

export async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}
