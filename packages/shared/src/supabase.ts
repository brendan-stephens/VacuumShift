import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser / dashboard client — publishable key only.
 * @see https://supabase.com/docs/guides/getting-started/api-keys
 */
export function createPublishableClient(
  url: string,
  publishableKey: string
): SupabaseClient {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

/**
 * Invoke register-database with current async auth session.
 */
export async function registerDatabase(
  supabase: SupabaseClient,
  functionsUrl: string,
  publishableKey: string,
  body: import('./register').RegisterDatabaseRequest
): Promise<import('./register').RegisterDatabaseResponse> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    throw new Error('Not signed in');
  }

  const res = await fetch(`${functionsUrl}/register-database`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publishableKey,
      Authorization: `Bearer ${sessionData.session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload.detail ?? payload.error ?? res.statusText);
  }
  return payload as import('./register').RegisterDatabaseResponse;
}
