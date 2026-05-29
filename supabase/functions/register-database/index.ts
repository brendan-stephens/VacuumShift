import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { normalizePostgresUri, parsePostgresUri } from '../_shared/connection-uri.ts';
import { testPostgresConnection } from '../_shared/postgres.ts';
import {
  preferencesToRpcJson,
  schedulesToRpcJson,
  validateRegisterRequest,
} from '../_shared/register.ts';
import { createAuthenticatedUserClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = validateRegisterRequest(body);
  if (!parsed.ok) {
    return jsonResponse({ error: parsed.error }, 400);
  }

  const auth = await createAuthenticatedUserClient(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error, detail: auth.error }, auth.status);
  }

  const { client: supabase } = auth;
  const { label, preferences, schedules } = parsed.data;
  const connectionString = normalizePostgresUri(parsed.data.connectionString);
  const uriUser = parsePostgresUri(connectionString)?.user?.toLowerCase();
  const maintenanceConnectionString =
    uriUser === 'postgres' || uriUser === 'supabase_admin' ? connectionString : null;

  const connectionTest = await testPostgresConnection(connectionString);
  if (!connectionTest.ok) {
    return jsonResponse(
      { error: 'Connection failed', detail: connectionTest.message },
      422
    );
  }

  const { data: registered, error: registerError } = await supabase.rpc(
    'register_monitored_database',
    {
      p_label: label,
      p_connection_string: connectionString,
      p_maintenance_connection_string: maintenanceConnectionString,
      p_preferences: preferencesToRpcJson(preferences),
      p_schedules: schedulesToRpcJson(schedules),
    }
  );

  if (registerError) {
    console.error('register_monitored_database', registerError);
    return jsonResponse(
      { error: 'Registration failed', detail: registerError.message },
      500
    );
  }

  const databaseId = registered?.database_id as string | undefined;
  if (!databaseId) {
    return jsonResponse({ error: 'Registration returned no database_id' }, 500);
  }

  const { error: healthError } = await supabase
    .from('monitored_databases')
    .update({
      last_health_at: new Date().toISOString(),
      last_health_ok: true,
      last_health_error: null,
    })
    .eq('id', databaseId);

  if (healthError) {
    console.error('health update', healthError);
  }

  return jsonResponse(
    {
      databaseId,
      connectionVaultId: registered.connection_vault_id as string,
      initialJobId: (registered.initial_job_id as string | null) ?? null,
      serverVersion: connectionTest.serverVersion,
    },
    201
  );
});
