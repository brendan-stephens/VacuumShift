import {
  completableObjectKeys,
  estimateCompletableInWindow,
  remainingWindowMs,
  type BloatCandidate,
} from '@vacuumshift/shared';
import { getActiveWindow, type ScheduleWindowSpec } from '@vacuumshift/shared';
import { rowToDatabasePreferences } from '@/lib/database-preferences';
import { filterCandidatesForDisplay } from '@/lib/filter-candidates';

export interface WindowEstimateContext {
  ratePagesPerSec: number | null;
  remainingMs: number;
  estimatedObjects: number;
  estimatedPages: number;
  completableKeys: Set<string>;
}

export function buildWindowEstimateContext(input: {
  bloatRows: Array<{
    schema_name: string;
    object_name: string;
    kind: string;
    bloat_bytes: number | string;
    bloat_pages: number | string | null;
  }>;
  prefs: ReturnType<typeof rowToDatabasePreferences>;
  activeWindowEnd: Date | null;
  cleanupRatePagesPerSec: number | null;
}): WindowEstimateContext | null {
  if (!input.activeWindowEnd) return null;

  const candidates: BloatCandidate[] = filterCandidatesForDisplay(
    input.bloatRows,
    input.prefs
  ).map((r) => ({
    kind: r.kind as 'table' | 'index',
    schemaName: r.schema_name,
    objectName: r.object_name,
    qualifiedName: `${r.schema_name}.${r.object_name}`,
    relationBytes: Number(r.relation_bytes ?? 0),
    bloatBytes: Number(r.bloat_bytes),
    bloatPages: r.bloat_pages != null ? Number(r.bloat_pages) : null,
    deadTupleEstimate: null,
  }));

  const remainingMs = remainingWindowMs(input.activeWindowEnd);
  const rate = input.cleanupRatePagesPerSec;
  const est = estimateCompletableInWindow(
    candidates,
    remainingMs,
    rate && rate > 0 ? rate : 32
  );
  const completableKeys = completableObjectKeys(candidates, remainingMs, rate);

  return {
    ratePagesPerSec: rate,
    remainingMs,
    estimatedObjects: est.objects,
    estimatedPages: est.pages,
    completableKeys,
  };
}

export function activeWindowEndFromSchedules(
  schedules: ScheduleWindowSpec[],
  now: Date = new Date()
): Date | null {
  let latestEnd: Date | null = null;
  for (const s of schedules) {
    const active = getActiveWindow(s, now);
    if (!active) continue;
    if (!latestEnd || active.windowEnd > latestEnd) {
      latestEnd = active.windowEnd;
    }
  }
  return latestEnd;
}
