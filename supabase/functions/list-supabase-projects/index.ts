import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { createAuthenticatedUserClient } from '../_shared/supabase.ts';
import {
  fetchSupabaseProjects,
  isProjectRunnable,
} from '../_shared/supabase-management.ts';
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

  let body: { accessToken?: string; saveToken?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  try {
    const token = await resolveSupabaseAccessToken(auth.client, body);

    const [projects, { data: monitored }] = await Promise.all([
      fetchSupabaseProjects(token),
      auth.client
        .from('monitored_databases')
        .select('supabase_project_ref')
        .not('supabase_project_ref', 'is', null),
    ]);

    const monitoredRefs = new Set(
      (monitored ?? [])
        .map((r) => r.supabase_project_ref as string)
        .filter(Boolean)
    );

    const list = projects
      .map((p) => ({
        ref: p.ref,
        name: p.name,
        region: p.region,
        status: p.status,
        organizationSlug: p.organization_slug,
        runnable: isProjectRunnable(p.status),
        alreadyMonitored: monitoredRefs.has(p.ref),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return jsonResponse({
      projects: list,
      tokenSaved: Boolean(body.saveToken && body.accessToken),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'Failed to list projects', detail: message }, 502);
  }
});
