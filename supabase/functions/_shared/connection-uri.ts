export interface PostgresUriParts {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

/** Parse a postgres URL and return decoded credentials (fixes double-encoding bugs). */
export function parsePostgresUri(raw: string): PostgresUriParts | null {
  const trimmed = raw.trim();
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) return null;

  try {
    const url = new URL(trimmed.replace(/^postgres:\/\//i, 'postgresql://'));
    const port = url.port ? Number(url.port) : 5432;
    if (!url.hostname || !url.username) return null;

    return {
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      host: url.hostname,
      port: Number.isFinite(port) ? port : 5432,
      database: url.pathname.replace(/^\//, '') || 'postgres',
    };
  } catch {
    return null;
  }
}

/** Build a postgres URL with a correctly encoded password (required for SCRAM auth). */
export function buildPostgresUri(parts: PostgresUriParts): string {
  const user = encodeURIComponent(parts.user);
  const password = encodeURIComponent(parts.password);
  return `postgresql://${user}:${password}@${parts.host}:${parts.port}/${parts.database}`;
}

/** Re-encode credentials so drivers receive the exact password bytes from the Management API. */
export function normalizePostgresUri(raw: string): string {
  const parsed = parsePostgresUri(raw);
  return parsed ? buildPostgresUri(parsed) : raw.trim();
}

/** Direct DB host for a Supabase cloud project (often IPv6-only). */
export function directDatabaseHost(projectRef: string): string {
  return `db.${projectRef}.supabase.co`;
}

export function isIpv6Host(host: string): boolean {
  return host.includes(':');
}

/** Supavisor pooler logins use `role.projectref`; direct DB uses plain role name. */
export function poolerLoginUser(user: string, projectRef: string, host: string): string {
  if (user.includes('.')) return user;
  if (/pooler\.supabase\./i.test(host)) {
    return `${user}.${projectRef}`;
  }
  return user;
}

const PLACEHOLDER_PASSWORD =
  /\[YOUR[-_]?PASSWORD\]|\[DB[-_]?PASSWORD\]|\[PASSWORD\]/i;

/** Mask password in a postgres URI for logs. */
export function redactPostgresUri(raw: string): string {
  const parsed = parsePostgresUri(raw);
  if (parsed) {
    return buildPostgresUri({ ...parsed, password: '***' });
  }
  return raw.replace(/:([^:@/]+)@/, ':***@');
}

export function debugLogConnection(
  label: string,
  uri: string,
  options?: { includeSecret?: boolean }
): void {
  const parsed = parsePostgresUri(uri);
  const includeSecret =
    options?.includeSecret ??
    Deno.env.get('DEBUG_CONNECTION_STRINGS') === '1';

  console.log(`[import-debug] ${label}`, {
    uri: includeSecret ? uri : redactPostgresUri(uri),
    user: parsed?.user,
    host: parsed?.host,
    port: parsed?.port,
    database: parsed?.database,
    passwordLength: parsed?.password.length ?? 0,
  });
}

/** Human-readable issue when a URI cannot be used as-is (Management API templates, etc.). */
export function connectionStringIssue(raw: string): string | null {
  if (PLACEHOLDER_PASSWORD.test(raw)) {
    return 'Supabase returned a template URI without your database password. Paste the password from Dashboard → Connect below.';
  }
  const parsed = parsePostgresUri(raw);
  if (!parsed) return 'Invalid connection string from Supabase API';
  if (!parsed.password) {
    return 'No database password in the Supabase API response. Paste it from Dashboard → Connect below.';
  }
  return null;
}
