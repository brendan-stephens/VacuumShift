export interface IndexMaintenanceEvent {
  schemaName: string;
  indexName: string;
  parentSchema: string;
  parentTable: string;
  valid: boolean;
  relationBytes: number;
  idxScan: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
  lastMaintenanceAt: string | null;
}

export interface InvalidIndexRow {
  id: string;
  schema_name: string;
  object_name: string;
  relation_bytes: number | string;
  parent_schema: string | null;
  parent_table: string | null;
  meta: {
    idx_scan?: number | null;
    parent_last_vacuum?: string | null;
    parent_last_autovacuum?: string | null;
  } | null;
}

export interface UnusedIndexRow {
  id: string;
  schema_name: string;
  object_name: string;
  relation_bytes: number | string;
  parent_schema: string | null;
  parent_table: string | null;
  meta: {
    idx_scan?: number | null;
    is_unique?: boolean;
  } | null;
}

export function parseIndexMaintenanceEvents(
  settings: unknown
): IndexMaintenanceEvent[] {
  if (!settings || typeof settings !== 'object') return [];
  const events = (settings as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  return events.map((e) => {
    const row = e as Record<string, unknown>;
    return {
      schemaName: String(row.schemaName ?? ''),
      indexName: String(row.indexName ?? ''),
      parentSchema: String(row.parentSchema ?? ''),
      parentTable: String(row.parentTable ?? ''),
      valid: Boolean(row.valid ?? true),
      relationBytes: Number(row.relationBytes ?? 0),
      idxScan: Number(row.idxScan ?? 0),
      lastVacuum: (row.lastVacuum as string | null) ?? null,
      lastAutovacuum: (row.lastAutovacuum as string | null) ?? null,
      lastAnalyze: (row.lastAnalyze as string | null) ?? null,
      lastAutoanalyze: (row.lastAutoanalyze as string | null) ?? null,
      lastMaintenanceAt: (row.lastMaintenanceAt as string | null) ?? null,
    };
  });
}

export function formatMaintenanceTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t) || t <= new Date('1970-01-02').getTime()) return 'Never';
  return new Date(iso).toLocaleString();
}
