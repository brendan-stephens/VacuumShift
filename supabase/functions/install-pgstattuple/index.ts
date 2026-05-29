import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { installPgstattupleExtension } from '../_shared/pgstattuple.ts';
import { grantVacuumshiftMaintenance } from '../_shared/vacuumshift-role.ts';
import { createAuthenticatedUserClient } from '../_shared/supabase.ts';
import { resolveSupabaseAccessToken } from '../_shared/resolve-pat.ts';

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
    databaseId?: string;
    accessToken?: string;
    queueRecheck?: boolean;
    installIfMissing?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const databaseId = body.databaseId?.trim();
  if (!databaseId) {
    return jsonResponse({ error: 'databaseId is required' }, 400);
  }

  const { data: db, error: fetchError } = await auth.client
    .from('monitored_databases')
    .select('id, supabase_project_ref')
    .eq('id', databaseId)
    .single();

  if (fetchError || !db) {
    return jsonResponse({ error: 'Database not found' }, 404);
  }

  const projectRef = db.supabase_project_ref as string | null;
  if (!projectRef) {
    return jsonResponse({
      ok: false,
      manual: true,
      sql: 'CREATE EXTENSION IF NOT EXISTS pgstattuple WITH SCHEMA extensions;',
      message:
        'This database was not imported from Supabase. Run the SQL above in the SQL editor as a superuser, then run npm run worker:once.',
    });
  }

  try {
    const token = await resolveSupabaseAccessToken(auth.client, body);
    const { extensionInstalled, pgstatindexAvailable } = await installPgstattupleExtension(
      token,
      projectRef,
      { installIfMissing: body.installIfMissing !== false }
    );

    let maintenanceGrantsApplied = false;
    let maintenanceGrantsError: string | null = null;
    try {
      const { pgMajor } = await grantVacuumshiftMaintenance(token, projectRef);
      if (pgMajor != null && pgMajor >= 17) {
        maintenanceGrantsApplied = true;
      } else if (pgMajor != null && pgMajor < 17) {
        maintenanceGrantsError =
          'Postgres 15/16: grant MAINTAIN to vacuumshift is not available. Re-import with your database password so maintenance uses postgres.';
      } else {
        maintenanceGrantsApplied = true;
      }
    } catch (grantErr) {
      maintenanceGrantsError =
        grantErr instanceof Error ? grantErr.message : String(grantErr);
      console.warn('[install-pgstattuple] maintenance grants:', maintenanceGrantsError);
    }

    let dbUpdated = false;
    if (extensionInstalled) {
      const { error: updateError } = await auth.client
        .from('monitored_databases')
        .update({
          pgstattuple_installed: true,
          index_bloat_estimated: !pgstatindexAvailable,
        })
        .eq('id', databaseId);
      if (updateError) {
        console.warn('[install-pgstattuple] could not update monitored_databases:', updateError.message);
      } else {
        dbUpdated = true;
      }
    }

    let recheckQueued = false;
    let initialJobId: string | null = null;
    let recheckError: string | null = null;

    if (body.queueRecheck !== false) {
      const { data: jobId, error: jobError } = await auth.client.rpc('queue_initial_check', {
        p_database_id: databaseId,
      });
      if (jobError) {
        recheckError = jobError.message;
        console.warn('[install-pgstattuple] could not queue recheck:', jobError.message);
      } else {
        recheckQueued = true;
        initialJobId = (jobId as string) ?? null;
      }
    }

    return jsonResponse({
      ok: true,
      extensionInstalled,
      pgstatindexAvailable,
      verified: extensionInstalled,
      dbUpdated,
      projectRef,
      maintenanceGrantsApplied,
      maintenanceGrantsError,
      recheckQueued,
      recheckError,
      initialJobId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'Failed to install extension', detail: message }, 502);
  }
});
