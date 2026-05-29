import { debugLogConnection } from '../_shared/connection-uri.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAuthenticatedUserClient } from '../_shared/supabase.ts';
import { testPostgresConnection } from '../_shared/postgres.ts';
import { pickWorkingConnection } from '../_shared/pick-connection.ts';
import {
  fetchProjectPoolerConfigs,
  maintenanceConnectionCandidates,
} from '../_shared/supabase-management.ts';
import { resolveSupabaseAccessToken } from '../_shared/resolve-pat.ts';
import { preferencesToRpcJson, schedulesToRpcJson } from '../_shared/register.ts';
import {
  grantVacuumshiftMaintenance,
  provisionVacuumshiftRole,
  VACUUMSHIFT_ROLE,
} from '../_shared/vacuumshift-role.ts';

interface ImportItem {
  ref: string;
  label?: string;
  runInitialCheck?: boolean;
  /** Postgres DB password (Settings → Database) for VACUUM/REINDEX on PG 15/16. */
  databasePassword?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const auth = await createAuthenticatedUserClient(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  let body: {
    accessToken?: string;
    saveToken?: boolean;
    /** Default postgres password for imports (PG 15/16 maintenance). */
    databasePassword?: string;
    projects?: ImportItem[];
    preferences?: Record<string, unknown>;
    schedules?: import('../_shared/types.ts').MaintenanceScheduleInput[];
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const items = body.projects ?? [];
  if (!items.length) {
    return jsonResponse({ error: 'projects array is required' }, 400);
  }

  try {
    const token = await resolveSupabaseAccessToken(auth.client, body);
    const prefs = preferencesToRpcJson(
      body.preferences as import('../_shared/types.ts').RegisterPreferencesInput
    );
    const schedules = schedulesToRpcJson(body.schedules);

    const results: Array<{
      ref: string;
      ok: boolean;
      databaseId?: string;
      initialJobId?: string | null;
      error?: string;
    }> = [];

    for (const item of items) {
      try {
        const poolers = await fetchProjectPoolerConfigs(token, item.ref);
        const debugSecrets = Deno.env.get('DEBUG_CONNECTION_STRINGS') === '1';
        console.log(`[import] ${item.ref} provisioning ${VACUUMSHIFT_ROLE} role`);

        let rolePassword: string;
        try {
          const provisioned = await provisionVacuumshiftRole(token, item.ref);
          rolePassword = provisioned.password;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({
            ref: item.ref,
            ok: false,
            error:
              `Could not create ${VACUUMSHIFT_ROLE} database role. ` +
              'Your Supabase PAT needs database write access. ' +
              message,
          });
          continue;
        }

        const candidates = maintenanceConnectionCandidates(item.ref, poolers, {
          databaseUser: VACUUMSHIFT_ROLE,
          databasePassword: rolePassword,
        });
        console.log(`[import] ${item.ref} ${candidates.length} candidate URI(s)`);
        if (!candidates.length) {
          results.push({
            ref: item.ref,
            ok: false,
            error: 'Could not build a connection URI from pooler settings',
          });
          continue;
        }

        const monitorPick = await pickWorkingConnection(item.ref, 'monitor', candidates);
        if (!monitorPick.picked) {
          results.push({
            ref: item.ref,
            ok: false,
            error:
              monitorPick.error ??
              `Connected role was created but login failed. Try again in a minute (pooler password cache).`,
          });
          continue;
        }
        const picked = monitorPick.picked;

        const dbPassword = (
          item.databasePassword ?? body.databasePassword ?? ''
        ).trim();

        let maintenanceConnectionString: string | null = null;
        let maintenanceWarning: string | null = null;

        if (dbPassword) {
          const postgresCandidates = maintenanceConnectionCandidates(item.ref, poolers, {
            databaseUser: 'postgres',
            databasePassword: dbPassword,
          });
          const maintPick = await pickWorkingConnection(
            item.ref,
            'maintenance (postgres)',
            postgresCandidates
          );
          if (maintPick.picked) {
            maintenanceConnectionString = maintPick.picked.connectionString;
            if (maintPick.picked.poolMode.toLowerCase() === 'transaction') {
              maintenanceWarning =
                'Maintenance uses transaction pooler; prefer session mode for VACUUM.';
            }
          } else {
            maintenanceWarning =
              maintPick.error ??
              'Could not connect as postgres for maintenance; checks will run but VACUUM/REINDEX may fail.';
          }
        } else {
          maintenanceWarning =
            'No database password provided — on Postgres 15/16 add it (Settings → Database) so maintenance can run as postgres.';
        }

        if (picked.poolMode.toLowerCase() === 'transaction') {
          console.warn(
            `import ${item.ref}: monitoring uses transaction pooler; prefer session mode`
          );
        }

        const label = item.label?.trim() || item.ref;
        const itemPrefs = {
          ...prefs,
          run_initial_check: item.runInitialCheck ?? prefs.run_initial_check ?? true,
        };

        const { data: registered, error: regError } = await auth.client.rpc(
          'register_monitored_database',
          {
            p_label: label,
            p_connection_string: picked.connectionString,
            p_maintenance_connection_string: maintenanceConnectionString,
            p_preferences: itemPrefs,
            p_supabase_project_ref: item.ref,
            p_supabase_monitoring_role: VACUUMSHIFT_ROLE,
            p_schedules: schedules,
          }
        );

        if (regError) {
          results.push({ ref: item.ref, ok: false, error: regError.message });
          continue;
        }

        try {
          await grantVacuumshiftMaintenance(token, item.ref);
        } catch (grantErr) {
          console.warn(`[import] ${item.ref} pg17 maintenance grants:`, grantErr);
        }

        results.push({
          ref: item.ref,
          ok: true,
          databaseId: registered.database_id as string,
          initialJobId: (registered.initial_job_id as string | null) ?? null,
          maintenanceConfigured: Boolean(maintenanceConnectionString),
          warning: maintenanceWarning,
        });
      } catch (err) {
        results.push({
          ref: item.ref,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const imported = results.filter((r) => r.ok).length;
    return jsonResponse({ imported, total: results.length, results }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'Import failed', detail: message }, 502);
  }
});
