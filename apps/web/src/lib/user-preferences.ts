import type { RegisterPreferencesInput } from '@vacuumshift/shared';

export type TableVacuumMode = 'vacuum' | 'vacuum_analyze';
export type IndexReindexMode = 'reindex' | 'reindex_concurrently';

export const TABLE_VACUUM_MODE_OPTIONS: { value: TableVacuumMode; label: string }[] = [
  { value: 'vacuum', label: 'VACUUM' },
  { value: 'vacuum_analyze', label: 'VACUUM ANALYZE' },
];

export const INDEX_REINDEX_MODE_OPTIONS: { value: IndexReindexMode; label: string }[] = [
  { value: 'reindex', label: 'REINDEX' },
  { value: 'reindex_concurrently', label: 'REINDEX CONCURRENTLY' },
];

export function formatTableVacuumMode(mode: TableVacuumMode): string {
  return TABLE_VACUUM_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
}

export function formatIndexReindexMode(mode: IndexReindexMode): string {
  return INDEX_REINDEX_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
}

export interface UserDefaultPreferences {
  min_table_size_mb: number;
  min_index_size_mb: number;
  table_vacuum_mode: TableVacuumMode;
  index_reindex_mode: IndexReindexMode;
  pause_between_ops_ms: number;
  exclude_patterns: string[];
  enforce_time_window: boolean;
}

export const SYSTEM_DEFAULT_PREFERENCES: UserDefaultPreferences = {
  min_table_size_mb: 0,
  min_index_size_mb: 0,
  table_vacuum_mode: 'vacuum',
  index_reindex_mode: 'reindex',
  pause_between_ops_ms: 0,
  exclude_patterns: [],
  enforce_time_window: false,
};

export function mergeUserDefaultPreferences(
  row: Partial<UserDefaultPreferences> | null | undefined
): UserDefaultPreferences {
  if (!row) return { ...SYSTEM_DEFAULT_PREFERENCES };
  return {
    min_table_size_mb: row.min_table_size_mb ?? SYSTEM_DEFAULT_PREFERENCES.min_table_size_mb,
    min_index_size_mb: row.min_index_size_mb ?? SYSTEM_DEFAULT_PREFERENCES.min_index_size_mb,
    table_vacuum_mode: row.table_vacuum_mode ?? SYSTEM_DEFAULT_PREFERENCES.table_vacuum_mode,
    index_reindex_mode: row.index_reindex_mode ?? SYSTEM_DEFAULT_PREFERENCES.index_reindex_mode,
    pause_between_ops_ms:
      row.pause_between_ops_ms ?? SYSTEM_DEFAULT_PREFERENCES.pause_between_ops_ms,
    exclude_patterns: row.exclude_patterns ?? SYSTEM_DEFAULT_PREFERENCES.exclude_patterns,
    enforce_time_window:
      row.enforce_time_window ?? SYSTEM_DEFAULT_PREFERENCES.enforce_time_window,
  };
}

export function parseExcludePatternsText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function formatExcludePatternsText(patterns: string[]): string {
  return patterns.join('\n');
}

/** Preferences json for register / import RPCs (includes run_initial_check). */
export function toNewDatabasePreferences(
  prefs: UserDefaultPreferences,
  overrides?: Partial<RegisterPreferencesInput>
): RegisterPreferencesInput {
  return {
    minTableSizeMb: prefs.min_table_size_mb,
    minIndexSizeMb: prefs.min_index_size_mb,
    tableVacuumMode: prefs.table_vacuum_mode,
    indexReindexMode: prefs.index_reindex_mode,
    pauseBetweenOpsMs: prefs.pause_between_ops_ms,
    excludePatterns: prefs.exclude_patterns,
    enforceTimeWindow: prefs.enforce_time_window,
    runInitialCheck: true,
    ...overrides,
  };
}
