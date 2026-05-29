import type { SupabaseClient } from '@supabase/supabase-js';
import type { BloatCandidate } from '@vacuumshift/shared';

export async function loadLatestBloatCandidates(
  supabase: SupabaseClient,
  databaseId: string
): Promise<{ capturedAt: string; candidates: BloatCandidate[] }> {
  const { data: latest, error: latestError } = await supabase
    .from('bloat_objects')
    .select('captured_at')
    .eq('database_id', databaseId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) throw latestError;
  if (!latest?.captured_at) {
    throw new Error('No bloat check snapshot — run a check first');
  }

  const { data: rows, error: rowsError } = await supabase
    .from('bloat_objects')
    .select(
      'kind, schema_name, object_name, relation_bytes, bloat_bytes, bloat_pages, parent_schema, parent_table'
    )
    .eq('database_id', databaseId)
    .eq('captured_at', latest.captured_at)
    .in('kind', ['table', 'index']);

  if (rowsError) throw rowsError;

  const candidates: BloatCandidate[] = (rows ?? []).map((row) => {
    const schemaName = row.schema_name;
    const objectName = row.object_name;
    return {
      kind: row.kind as 'table' | 'index',
      schemaName,
      objectName,
      qualifiedName: `${schemaName}.${objectName}`,
      relationBytes: Number(row.relation_bytes),
      bloatBytes: Number(row.bloat_bytes),
      bloatPages: row.bloat_pages != null ? Number(row.bloat_pages) : null,
      deadTupleEstimate: null,
      parentSchema: row.parent_schema ?? undefined,
      parentTable: row.parent_table ?? undefined,
    };
  });

  return { capturedAt: latest.captured_at, candidates };
}
