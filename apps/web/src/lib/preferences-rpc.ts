import type { UserDefaultPreferences } from '@/lib/user-preferences';

export function preferencesToSaveRpc(prefs: UserDefaultPreferences) {
  return {
    p_min_table_size_mb: prefs.min_table_size_mb,
    p_min_index_size_mb: prefs.min_index_size_mb,
    p_table_vacuum_mode: prefs.table_vacuum_mode,
    p_index_reindex_mode: prefs.index_reindex_mode,
    p_pause_between_ops_ms: prefs.pause_between_ops_ms,
    p_exclude_patterns: prefs.exclude_patterns,
    p_enforce_time_window: prefs.enforce_time_window,
  };
}
