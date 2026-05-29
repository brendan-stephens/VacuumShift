export type ScheduleRecurrence = 'daily' | 'weekly' | 'monthly' | 'bespoke';
export type TableVacuumMode = 'vacuum' | 'vacuum_analyze';
export type IndexReindexMode = 'reindex' | 'reindex_concurrently';
export type BloatObjectKind = 'table' | 'index' | 'invalid_index' | 'unused_index';
export type JobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';
export type JobRunKind = 'scheduled' | 'initial' | 'manual';

export interface DatabasePreferences {
  minTableSizeMb: number;
  minIndexSizeMb: number;
  tableVacuumMode: TableVacuumMode;
  indexReindexMode: IndexReindexMode;
  pauseBetweenOpsMs: number;
  excludePatterns: string[];
  runInitialCheck: boolean;
  /** When true, statement_timeout ends ops at window end + 30s grace. */
  enforceTimeWindow: boolean;
}

export * from './exclude-patterns';
export * from './schedule-window';
export * from './postgres-gucs';
export * from './connection-uri';
export * from './register';
export * from './timeout';
export * from './supabase';

export interface BloatCandidate {
  kind: BloatObjectKind;
  schemaName: string;
  objectName: string;
  qualifiedName: string;
  relationBytes: number;
  bloatBytes: number;
  bloatPages: number | null;
  deadTupleEstimate: number | null;
  parentSchema?: string;
  parentTable?: string;
}

/** Pages reclaimed per second from a completed operation. */
export function cleanupRatePagesPerSec(
  pagesBefore: number,
  pagesAfter: number,
  durationMs: number
): number | null {
  if (durationMs <= 0) return null;
  const reclaimed = Math.max(0, pagesBefore - pagesAfter);
  return reclaimed / (durationMs / 1000);
}

/**
 * Estimate how many objects (or pages) fit in remaining window time
 * using a rolling average cleanup rate from recent operations.
 */
export function estimateCompletableInWindow<T extends { bloatPages: number | null }>(
  candidates: T[],
  remainingMs: number,
  ratePagesPerSec: number
): { objects: number; pages: number } {
  if (ratePagesPerSec <= 0 || remainingMs <= 0) {
    return { objects: 0, pages: 0 };
  }
  const budgetPages = ratePagesPerSec * (remainingMs / 1000);
  let pages = 0;
  let objects = 0;
  for (const c of candidates) {
    const need = c.bloatPages ?? 0;
    if (pages + need > budgetPages) break;
    pages += need;
    objects += 1;
  }
  return { objects, pages: Math.floor(pages) };
}

const DEFAULT_ESTIMATE_RATE_PAGES_PER_SEC = 32;

/** Object keys (schema.object) estimated to fit in the remaining window. */
export function completableObjectKeys<T extends { schemaName: string; objectName: string; bloatPages: number | null }>(
  candidates: T[],
  remainingMs: number,
  ratePagesPerSec: number | null | undefined
): Set<string> {
  const rate = ratePagesPerSec && ratePagesPerSec > 0 ? ratePagesPerSec : DEFAULT_ESTIMATE_RATE_PAGES_PER_SEC;
  const budgetPages = rate * (remainingMs / 1000);
  const keys = new Set<string>();
  let used = 0;
  for (const c of candidates) {
    const need =
      c.bloatPages ?? Math.max(1, Math.ceil((c.bloatBytes ?? 0) / 8192));
    if (used + need > budgetPages) break;
    used += need;
    keys.add(`${c.schemaName}.${c.objectName}`);
  }
  return keys;
}
