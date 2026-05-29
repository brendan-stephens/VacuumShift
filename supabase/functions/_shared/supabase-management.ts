import {
  buildPostgresUri,
  directDatabaseHost,
  isIpv6Host,
  normalizePostgresUri,
  parsePostgresUri,
  poolerLoginUser,
  type PostgresUriParts,
} from './connection-uri.ts';

const MANAGEMENT_API = 'https://api.supabase.com/v1';

export class SupabaseManagementError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'SupabaseManagementError';
  }
}

async function managementFetch(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(`${MANAGEMENT_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  return res;
}

async function managementJson<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await managementFetch(accessToken, path, init);
  if (!res.ok) {
    const body = await res.text();
    throw new SupabaseManagementError(
      `${path}: ${res.status} ${body.slice(0, 200)}`,
      res.status
    );
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

export interface CliLoginRole {
  role: string;
  password: string;
  ttl_seconds: number;
}

export async function createCliLoginRole(
  accessToken: string,
  projectRef: string,
  readOnly: boolean
): Promise<CliLoginRole> {
  return managementJson<CliLoginRole>(
    accessToken,
    `/projects/${encodeURIComponent(projectRef)}/cli/login-role`,
    {
      method: 'POST',
      body: JSON.stringify({ read_only: readOnly }),
    }
  );
}

export async function deleteCliLoginRole(
  accessToken: string,
  projectRef: string
): Promise<void> {
  await managementJson(
    accessToken,
    `/projects/${encodeURIComponent(projectRef)}/cli/login-role`,
    { method: 'DELETE' }
  );
}

export async function runDatabaseQuery(
  accessToken: string,
  projectRef: string,
  query: string
): Promise<void> {
  await runDatabaseQueryRead(accessToken, projectRef, query);
}

export async function runDatabaseQueryRead<T = Record<string, unknown>>(
  accessToken: string,
  projectRef: string,
  query: string
): Promise<T[]> {
  const data = await managementJson<T[] | T>(
    accessToken,
    `/projects/${encodeURIComponent(projectRef)}/database/query`,
    {
      method: 'POST',
      body: JSON.stringify({ query }),
    }
  );
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data as T];
  return [];
}

export interface SupabaseProjectSummary {
  id: string;
  ref: string;
  name: string;
  region: string;
  status: string;
  organization_slug: string | null;
}

export interface PoolerConfig {
  connection_string?: string;
  connectionString?: string;
  pool_mode?: string;
  database_type?: string;
  db_user?: string;
  db_host?: string;
  db_port?: number;
  db_name?: string;
}

export async function fetchSupabaseProjects(
  accessToken: string
): Promise<SupabaseProjectSummary[]> {
  const data = await managementJson<SupabaseProjectSummary[]>(
    accessToken,
    '/projects'
  );
  return Array.isArray(data) ? data : [];
}

export async function fetchProjectPoolerConfigs(
  accessToken: string,
  projectRef: string
): Promise<PoolerConfig[]> {
  const data = await managementJson<PoolerConfig[]>(
    accessToken,
    `/projects/${encodeURIComponent(projectRef)}/config/database/pooler`
  );
  return Array.isArray(data) ? data : [];
}

function rawPoolerUri(pick: PoolerConfig): string | null {
  return pick.connection_string ?? pick.connectionString ?? null;
}

/** Prefer session pooler URI for VACUUM-capable connections. */
export function pickMaintenancePooler(
  poolers: PoolerConfig[]
): { connectionString: string; poolMode: string } | null {
  const withUri = poolers.filter((p) => rawPoolerUri(p));
  const session = withUri.find(
    (p) => (p.pool_mode ?? '').toLowerCase() === 'session'
  );
  const primary = withUri.find(
    (p) => (p.database_type ?? '').toUpperCase() === 'PRIMARY'
  );
  const pick = session ?? primary ?? withUri[0];
  if (!pick) return null;

  const raw = rawPoolerUri(pick);
  if (!raw) return null;

  return {
    connectionString: normalizePostgresUri(raw),
    poolMode: pick.pool_mode ?? 'unknown',
  };
}

function candidatesFromCredentials(
  projectRef: string,
  poolers: PoolerConfig[],
  user: string,
  password: string
): Array<{ connectionString: string; poolMode: string }> {
  const out: Array<{ connectionString: string; poolMode: string }> = [];
  const seen = new Set<string>();

  const push = (parts: PostgresUriParts, poolMode: string) => {
    const uri = buildPostgresUri(parts);
    if (seen.has(uri)) return;
    seen.add(uri);
    out.push({ connectionString: uri, poolMode });
  };

  for (const p of poolers) {
    const raw = rawPoolerUri(p);
    if (raw) {
      const template = parsePostgresUri(normalizePostgresUri(raw));
      if (template && !isIpv6Host(template.host)) {
        push(
          {
            user: poolerLoginUser(user, projectRef, template.host),
            password,
            host: template.host,
            port: template.port,
            database: p.db_name ?? template.database,
          },
          p.pool_mode ?? 'pooler'
        );
      }
    }
  }

  for (const p of poolers) {
    if (!p.db_host || isIpv6Host(p.db_host)) continue;
    push(
      {
        user: poolerLoginUser(user, projectRef, p.db_host),
        password,
        host: p.db_host,
        port: p.db_port ?? 5432,
        database: p.db_name ?? 'postgres',
      },
      p.pool_mode ?? 'manual'
    );
  }

  const directHost = directDatabaseHost(projectRef);
  push(
    {
      user: 'postgres',
      password,
      host: directHost,
      port: 5432,
      database: 'postgres',
    },
    'direct'
  );

  if (user !== 'postgres') {
    push(
      {
        user,
        password,
        host: directHost,
        port: 5432,
        database: 'postgres',
      },
      'direct-user'
    );
  }

  return out;
}

/** Candidate URIs for a monitoring login (e.g. provisioned `vacuumshift` role). */
export function maintenanceConnectionCandidates(
  projectRef: string,
  poolers: PoolerConfig[],
  options: { databaseUser: string; databasePassword: string }
): Array<{ connectionString: string; poolMode: string }> {
  const user = options.databaseUser.trim();
  const password = options.databasePassword.trim();
  if (!user || !password) return [];

  return candidatesFromCredentials(projectRef, poolers, user, password);
}

export function isProjectRunnable(status: string): boolean {
  const s = status.toUpperCase();
  return s === 'ACTIVE_HEALTHY' || s === 'ACTIVE' || s === 'COMING_UP';
}
