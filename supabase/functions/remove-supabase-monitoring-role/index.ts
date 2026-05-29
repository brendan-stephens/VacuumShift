import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAuthenticatedUserClient } from '../_shared/supabase.ts';
import { resolveSupabaseAccessToken } from '../_shared/resolve-pat.ts';
import { dropVacuumshiftRole } from '../_shared/vacuumshift-role.ts';

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

  let body: { accessToken?: string; databaseId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const databaseId = body.databaseId?.trim();
  if (!databaseId) {
    return jsonResponse({ error: 'databaseId is required' }, 400);
  }

  const { data: row, error: fetchError } = await auth.client
    .from('monitored_databases')
    .select('supabase_project_ref, supabase_monitoring_role')
    .eq('id', databaseId)
    .single();

  if (fetchError || !row) {
    return jsonResponse({ error: 'Database not found' }, 404);
  }

  const projectRef = row.supabase_project_ref as string | null;
  const monitoringRole = row.supabase_monitoring_role as string | null;
  if (!projectRef || !monitoringRole) {
    return jsonResponse({
      error: 'This database was not imported from Supabase with a provisioned role',
    }, 400);
  }

  try {
    const token = await resolveSupabaseAccessToken(auth.client, body);
    await dropVacuumshiftRole(token, projectRef);
    return jsonResponse({ ok: true, role: monitoringRole, projectRef });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'Failed to remove database role', detail: message }, 502);
  }
});
