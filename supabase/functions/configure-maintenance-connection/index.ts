import { normalizePostgresUri } from '../_shared/connection-uri.ts';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { pickWorkingConnection } from '../_shared/pick-connection.ts';
import { testPostgresConnection } from '../_shared/postgres.ts';
import { resolveSupabaseAccessToken } from '../_shared/resolve-pat.ts';
import {
  fetchProjectPoolerConfigs,
  maintenanceConnectionCandidates,
} from '../_shared/supabase-management.ts';
import { createAuthenticatedUserClient } from '../_shared/supabase.ts';

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
    connectionString?: string;
    databasePassword?: string;
    accessToken?: string;
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

  const { data: row, error: dbError } = await auth.client
    .from('monitored_databases')
    .select('id, supabase_project_ref')
    .eq('id', databaseId)
    .single();

  if (dbError || !row) {
    return jsonResponse({ error: 'Database not found' }, 404);
  }

  let connectionString: string | null = null;

  const rawUri = body.connectionString?.trim();
  const dbPassword = body.databasePassword?.trim();

  if (rawUri) {
    connectionString = normalizePostgresUri(rawUri);
  } else if (dbPassword && row.supabase_project_ref) {
    try {
      const token = await resolveSupabaseAccessToken(auth.client, body);
      const poolers = await fetchProjectPoolerConfigs(token, row.supabase_project_ref);
      const candidates = maintenanceConnectionCandidates(row.supabase_project_ref, poolers, {
        databaseUser: 'postgres',
        databasePassword: dbPassword,
      });
      if (!candidates.length) {
        return jsonResponse({ error: 'Could not build connection URI from pooler settings' }, 422);
      }
      const pick = await pickWorkingConnection(
        row.supabase_project_ref,
        'maintenance (postgres)',
        candidates
      );
      if (!pick.picked) {
        return jsonResponse(
          { error: pick.error ?? 'Could not connect as postgres' },
          422
        );
      }
      connectionString = pick.picked.connectionString;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: message }, 502);
    }
  } else {
    return jsonResponse(
      {
        error:
          'Provide connectionString or databasePassword (Supabase projects only for password)',
      },
      400
    );
  }

  const test = await testPostgresConnection(connectionString);
  if (!test.ok) {
    return jsonResponse({ error: 'Connection failed', detail: test.message }, 422);
  }

  const { error: saveError } = await auth.client.rpc('save_database_maintenance_connection', {
    p_database_id: databaseId,
    p_connection_string: connectionString,
  });

  if (saveError) {
    return jsonResponse({ error: 'Failed to save', detail: saveError.message }, 500);
  }

  return jsonResponse({ ok: true, serverVersion: test.serverVersion });
});
