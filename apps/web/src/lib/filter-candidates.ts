import type { DatabasePreferences } from '@/lib/database-preferences';
import { isObjectExcluded, type BloatObjectKind } from '@vacuumshift/shared';

/** Client-side mirror of worker filterCandidates for display estimates. */
export function filterCandidatesForDisplay(
  rows: Array<{ kind: string; schema_name: string; object_name: string; relation_bytes?: number | string }>,
  prefs: DatabasePreferences
): Array<{
  kind: string;
  schema_name: string;
  object_name: string;
  relation_bytes?: number | string;
  bloat_bytes: number | string;
  bloat_pages: number | string | null;
}> {
  const minTableBytes = prefs.min_table_size_mb * 1024 * 1024;
  const minIndexBytes = prefs.min_index_size_mb * 1024 * 1024;

  return rows.filter((row) => {
    if (row.kind !== 'table' && row.kind !== 'index') return false;
    const minBytes = row.kind === 'table' ? minTableBytes : minIndexBytes;
    const relationBytes = Number(row.relation_bytes ?? 0);
    if (relationBytes < minBytes) return false;
    if (
      isObjectExcluded(prefs.exclude_patterns, {
        schemaName: row.schema_name,
        objectName: row.object_name,
      })
    ) {
      return false;
    }
    return true;
  }) as Array<{
    kind: string;
    schema_name: string;
    object_name: string;
    bloat_bytes: number | string;
    bloat_pages: number | string | null;
  }>;
}

export function isMaintainableKind(kind: string): kind is BloatObjectKind {
  return kind === 'table' || kind === 'index';
}
