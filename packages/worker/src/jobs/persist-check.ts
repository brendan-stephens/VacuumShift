import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutovacuumSnapshot } from '../check/collect-autovacuum.js';
import type { BloatCheckResult } from '../types.js';

const BLOAT_INSERT_CHUNK = 200;

export async function persistBloatCheck(
  supabase: SupabaseClient,
  databaseId: string,
  check: BloatCheckResult,
  autovacuum: AutovacuumSnapshot,
  metricsSource: 'check' | 'post_job' = 'check'
): Promise<void> {
  const capturedAt = autovacuum.capturedAt;

  const { data: metrics, error: metricsError } = await supabase
    .from('database_metrics')
    .insert({
      database_id: databaseId,
      captured_at: capturedAt,
      database_size_bytes: check.databaseSizeBytes,
      table_bloat_bytes: check.tableBloatBytes,
      index_bloat_bytes: check.indexBloatBytes,
      table_bloat_pages: check.tableBloatPages,
      index_bloat_pages: check.indexBloatPages,
      pgstattuple_installed: check.pgstattupleInstalled,
      index_bloat_estimated: check.indexBloatEstimated,
      reclaimable_bytes: check.reclaimableBytes,
      source: metricsSource,
    })
    .select('id')
    .single();

  if (metricsError) throw metricsError;
  const metricsId = metrics.id as string;

  for (let i = 0; i < check.objects.length; i += BLOAT_INSERT_CHUNK) {
    const chunk = check.objects.slice(i, i + BLOAT_INSERT_CHUNK).map((o) => ({
      database_id: databaseId,
      metrics_id: metricsId,
      captured_at: capturedAt,
      kind: o.kind,
      schema_name: o.schemaName,
      object_name: o.objectName,
      relation_bytes: o.relationBytes,
      bloat_bytes: o.bloatBytes,
      bloat_pages: o.bloatPages,
      dead_tuple_estimate: o.deadTupleEstimate,
      parent_schema: o.parentSchema ?? null,
      parent_table: o.parentTable ?? null,
      meta: o.meta ?? null,
    }));

    const { error: bloatError } = await supabase.from('bloat_objects').insert(chunk);
    if (bloatError) throw bloatError;
  }

  const { error: globalError } = await supabase.from('autovacuum_settings').insert({
    database_id: databaseId,
    captured_at: capturedAt,
    scope: 'global',
    schema_name: null,
    table_name: null,
    settings: { parameters: autovacuum.global },
  });
  if (globalError) throw globalError;

  if (check.indexMaintenanceEvents.length) {
    const { error: indexMaintError } = await supabase.from('autovacuum_settings').insert({
      database_id: databaseId,
      captured_at: capturedAt,
      scope: 'index_maintenance',
      schema_name: null,
      table_name: null,
      settings: { events: check.indexMaintenanceEvents },
    });
    if (indexMaintError) throw indexMaintError;
  }

  for (let i = 0; i < autovacuum.tables.length; i += BLOAT_INSERT_CHUNK) {
    const chunk = autovacuum.tables.slice(i, i + BLOAT_INSERT_CHUNK).map((t) => ({
      database_id: databaseId,
      captured_at: capturedAt,
      scope: 'table' as const,
      schema_name: t.schema_name,
      table_name: t.table_name,
      settings: {
        reloptions: t.reloptions ?? [],
        stats: t.stat_snapshot,
      },
    }));

    const { error: tableError } = await supabase.from('autovacuum_settings').insert(chunk);
    if (tableError) throw tableError;
  }
}
