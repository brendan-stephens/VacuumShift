import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.49.0';

export async function resolveSupabaseAccessToken(
  userClient: SupabaseClient,
  body: { accessToken?: string; saveToken?: boolean }
): Promise<string> {
  const trimmed = body.accessToken?.trim();
  if (trimmed) {
    if (body.saveToken) {
      const { error } = await userClient.rpc('save_supabase_access_token', {
        p_access_token: trimmed,
      });
      if (error) throw new Error(`Failed to save token: ${error.message}`);
    }
    return trimmed;
  }

  const { data, error } = await userClient.rpc('get_user_supabase_access_token');
  if (error || !data) {
    throw new Error(
      'No Supabase access token. Paste a personal access token or save one first.'
    );
  }
  return data as string;
}
