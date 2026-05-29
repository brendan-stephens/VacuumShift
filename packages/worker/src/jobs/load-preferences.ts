import type { SupabaseClient } from '@supabase/supabase-js';
import type { DatabasePreferences } from '@vacuumshift/shared';

export async function loadDatabasePreferences(
  supabase: SupabaseClient,
  databaseId: string
): Promise<DatabasePreferences> {
  const { data, error } = await supabase
    .from('database_preferences')
    .select(
      'min_table_size_mb, min_index_size_mb, table_vacuum_mode, index_reindex_mode, pause_between_ops_ms, exclude_patterns, enforce_time_window'
    )
    .eq('database_id', databaseId)
    .single();

  if (error || !data) {
    throw new Error('Database preferences not found');
  }

  return {
    minTableSizeMb: data.min_table_size_mb,
    minIndexSizeMb: data.min_index_size_mb,
    tableVacuumMode: data.table_vacuum_mode,
    indexReindexMode: data.index_reindex_mode,
    pauseBetweenOpsMs: data.pause_between_ops_ms,
    excludePatterns: data.exclude_patterns ?? [],
    runInitialCheck: false,
    enforceTimeWindow: data.enforce_time_window,
  };
}
