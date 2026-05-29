import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.0';

/**
 * Publishable key from the request `apikey` header.
 * Edge Functions must not duplicate SUPABASE_PUBLISHABLE_KEY in env: the CLI skips
 * SUPABASE_* names from --env-file so they are not overridden. Validity is proven
 * when Auth accepts the user's JWT with that key.
 */
export function getRequestPublishableKey(req: Request): string | null {
  const key = req.headers.get('apikey')?.trim();
  if (!key?.startsWith('sb_publishable_')) return null;
  return key;
}

/** Injected by `supabase functions serve` / platform — not from --env-file. */
export function getSupabaseUrl(): string | null {
  return Deno.env.get('SUPABASE_URL') ?? null;
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match?.[1] ?? null;
}

export type UserClientResult =
  | { ok: true; client: SupabaseClient; userId: string }
  | { ok: false; status: number; error: string };

/**
 * User-scoped client: publishable key from request + user access token.
 * @see https://supabase.com/docs/guides/getting-started/api-keys
 * @see https://supabase.com/docs/guides/functions/auth-headers
 */
export async function createAuthenticatedUserClient(
  req: Request
): Promise<UserClientResult> {
  const url = getSupabaseUrl();
  const publishableKey = getRequestPublishableKey(req);

  if (!url) {
    return {
      ok: false,
      status: 500,
      error: 'Missing SUPABASE_URL (should be injected by supabase functions serve)',
    };
  }

  if (!publishableKey) {
    return {
      ok: false,
      status: 401,
      error: 'Missing or invalid apikey header (expected sb_publishable_...)',
    };
  }

  const token = extractBearerToken(req.headers.get('Authorization'));
  if (!token) {
    return { ok: false, status: 401, error: 'Missing Authorization Bearer token' };
  }

  const verified = await verifyUserAccessToken(url, publishableKey, token);
  if (!verified.ok) {
    return { ok: false, status: 401, error: verified.error };
  }

  const authed = createClient(url, publishableKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: publishableKey,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return { ok: true, client: authed, userId: verified.userId };
}

/** Validate user JWT via Auth API (works with publishable keys in Edge). */
async function verifyUserAccessToken(
  supabaseUrl: string,
  publishableKey: string,
  accessToken: string
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const authUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`;
  const res = await fetch(authUrl, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      msg?: string;
      message?: string;
      error_description?: string;
    };
    const detail =
      body.msg ?? body.message ?? body.error_description ?? res.statusText;
    return {
      ok: false,
      error:
        `Invalid or expired session (${detail}). ` +
        'Sign in again — tokens are invalidated after `supabase db reset`.',
    };
  }

  const user = (await res.json()) as { id?: string };
  if (!user.id) {
    return { ok: false, error: 'Auth API returned no user id' };
  }

  return { ok: true, userId: user.id };
}
