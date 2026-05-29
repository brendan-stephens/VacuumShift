import type { SupabaseClient } from '@supabase/supabase-js';
import type { DatabasePreferences } from '@vacuumshift/shared';
import { collectAutovacuumSettings } from '../check/collect-autovacuum.js';
import { collectBloat } from '../check/collect-bloat.js';
import { thresholdsFromPreferences } from '../check/thresholds.js';
import { connectionStringForHostRunner } from '../connection-string.js';
import { getConnectionString } from '../vault.js';
import { persistBloatCheck } from './persist-check.js';

export async function runCheckPhase(
  supabase: SupabaseClient,
  databaseId: string,
  connectionVaultId: string,
  prefs: DatabasePreferences,
  metricsSource: 'check' | 'post_job' = 'check'
): Promise<{ objectCount: number; tableBloatPages: number; indexBloatPages: number }> {
  const stored = await getConnectionString(connectionVaultId);
  const connectionString = connectionStringForHostRunner(stored);
  const thresholds = thresholdsFromPreferences(prefs);

  const [bloat, autovacuum] = await Promise.all([
    collectBloat(connectionString, thresholds),
    collectAutovacuumSettings(connectionString),
  ]);

  await persistBloatCheck(supabase, databaseId, bloat, autovacuum, metricsSource);

  await supabase
    .from('monitored_databases')
    .update({
      last_health_at: autovacuum.capturedAt,
      last_health_ok: true,
      last_health_error: null,
      pgstattuple_installed: bloat.pgstattupleInstalled,
      index_bloat_estimated: bloat.indexBloatEstimated,
    })
    .eq('id', databaseId);

  return {
    objectCount: bloat.objects.length,
    tableBloatPages: bloat.tableBloatPages,
    indexBloatPages: bloat.indexBloatPages,
  };
}
