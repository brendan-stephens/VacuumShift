export interface PostgresUriParts {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

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

export function buildPostgresUri(parts: PostgresUriParts): string {
  const user = encodeURIComponent(parts.user);
  const password = encodeURIComponent(parts.password);
  return `postgresql://${user}:${password}@${parts.host}:${parts.port}/${parts.database}`;
}

export function normalizePostgresUri(raw: string): string {
  const parsed = parsePostgresUri(raw);
  return parsed ? buildPostgresUri(parsed) : raw.trim();
}

export function isIpv6Host(host: string): boolean {
  return host.includes(':');
}

const PLACEHOLDER_PASSWORD =
  /\[YOUR[-_]?PASSWORD\]|\[DB[-_]?PASSWORD\]|\[PASSWORD\]/i;

export function connectionStringIssue(raw: string): string | null {
  if (PLACEHOLDER_PASSWORD.test(raw)) {
    return 'Connection string is a template without a database password.';
  }
  const parsed = parsePostgresUri(raw);
  if (!parsed) return 'Invalid connection string';
  if (!parsed.password) return 'Connection string has no password';
  return null;
}
