import type { UserDefaultPreferences } from '@/lib/user-preferences';
import type { TableVacuumMode, IndexReindexMode } from '@/lib/user-preferences';

export type DatabasePreferences = UserDefaultPreferences;

export function rowToDatabasePreferences(row: {
  min_table_size_mb: number;
  min_index_size_mb: number;
  table_vacuum_mode: TableVacuumMode;
  index_reindex_mode: IndexReindexMode;
  pause_between_ops_ms: number;
  exclude_patterns: string[];
  enforce_time_window: boolean;
}): DatabasePreferences {
  return {
    min_table_size_mb: row.min_table_size_mb,
    min_index_size_mb: row.min_index_size_mb,
    table_vacuum_mode: row.table_vacuum_mode,
    index_reindex_mode: row.index_reindex_mode,
    pause_between_ops_ms: row.pause_between_ops_ms,
    exclude_patterns: row.exclude_patterns ?? [],
    enforce_time_window: row.enforce_time_window,
  };
}
