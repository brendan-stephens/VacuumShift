import {
  createCliLoginRole,
  deleteCliLoginRole,
  runDatabaseQuery,
} from './supabase-management.ts';

export const VACUUMSHIFT_ROLE = 'vacuumshift';

/** Postgres 17+ — MAINTAIN / pg_maintain (not available on 15/16). */
export const PG17_SERVER_VERSION_NUM = 170000;

/** User/application schemas (not only public): all except system catalogs. */
const USER_SCHEMAS_SQL = `
  nspname NOT IN ('pg_catalog', 'information_schema')
  AND nspname NOT LIKE 'pg_toast%'
  AND nspname NOT LIKE 'pg_temp_%'
`;

/** Monitoring grants applied in every user schema (best-effort per schema). */
function grantMonitoringOnSchemaSql(role: string): string {
  return `
    BEGIN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO ${role}', s.nspname);
      EXECUTE format(
        'GRANT SELECT ON ALL TABLES IN SCHEMA %I TO ${role}',
        s.nspname
      );
      EXECUTE format(
        'GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO ${role}',
        s.nspname
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'vacuumshift: skip schema % (%)', s.nspname, SQLERRM;
    END;
`.trim();
}

function sqlPasswordLiteral(password: string): string {
  const tag = `vs_${crypto.randomUUID().replace(/-/g, '')}`;
  if (!password.includes(tag)) {
    return `$${tag}$${password}$${tag}$`;
  }
  return `'${password.replace(/'/g, "''")}'`;
}

/** PG 17+ only: per-schema MAINTAIN and pg_maintain membership. */
function grantPg17MaintenanceSql(role: string): string {
  return `
  IF current_setting('server_version_num')::int >= ${PG17_SERVER_VERSION_NUM} THEN
    FOR s IN
      SELECT nspname FROM pg_namespace
      WHERE ${USER_SCHEMAS_SQL}
    LOOP
      BEGIN
        EXECUTE format(
          'GRANT MAINTAIN ON ALL TABLES IN SCHEMA %I TO ${role}',
          s.nspname
        );
      EXCEPTION
        WHEN OTHERS THEN NULL;
      END;
    END LOOP;
    BEGIN
      EXECUTE 'GRANT pg_maintain TO ${role}';
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END IF;
`.trim();
}

/**
 * Create or reset the monitoring role. Avoids GRANT on predefined roles unless the
 * session is allowed (wrapped in exception handlers); Supabase Management API often
 * runs without ADMIN OPTION on pg_* roles.
 *
 * PG 15+: SELECT + stats only on vacuumshift. VACUUM/REINDEX use a separate postgres
 * maintenance connection (see maintenance_connection_vault_id).
 */
export function createVacuumshiftRoleSql(password: string): string {
  const pw = sqlPasswordLiteral(password);
  const role = VACUUMSHIFT_ROLE;
  const pg17Grants = grantPg17MaintenanceSql(role);
  return `
DO $vs$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} WITH LOGIN PASSWORD ${pw} NOINHERIT;
  ELSE
    ALTER ROLE ${role} WITH LOGIN PASSWORD ${pw};
  END IF;
END
$vs$;

GRANT CONNECT ON DATABASE postgres TO ${role};

DO $vs$
DECLARE s record;
BEGIN
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE ${USER_SCHEMAS_SQL}
  LOOP
    ${grantMonitoringOnSchemaSql(role)}
  END LOOP;

  ${pg17Grants}
END
$vs$;

GRANT USAGE ON SCHEMA pg_catalog TO ${role};
GRANT SELECT ON pg_class, pg_namespace, pg_index TO ${role};
GRANT SELECT ON pg_stat_user_tables TO ${role};
GRANT SELECT ON pg_stats TO ${role};
GRANT SELECT ON pg_extension TO ${role};

DO $vs$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA extensions TO ${role}';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO ${role}';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END
$vs$;

DO $vs$
BEGIN
  EXECUTE 'GRANT pg_read_all_stats TO ${role}';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END
$vs$;

DO $vs$
BEGIN
  EXECUTE 'GRANT pg_read_all_settings TO ${role}';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END
$vs$;

DO $vs$
BEGIN
  EXECUTE 'GRANT pg_monitor TO ${role}';
EXCEPTION
  WHEN insufficient_privilege THEN NULL;
END
$vs$;
`.trim();
}

export function dropVacuumshiftRoleSql(): string {
  const role = VACUUMSHIFT_ROLE;
  return `
DO $vs$
DECLARE s record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    RETURN;
  END IF;

  BEGIN
    EXECUTE 'REVOKE pg_maintain FROM ${role}';
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  BEGIN
    EXECUTE 'REVOKE pg_read_all_stats FROM ${role}';
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;
  BEGIN
    EXECUTE 'REVOKE pg_read_all_settings FROM ${role}';
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;
  BEGIN
    EXECUTE 'REVOKE pg_monitor FROM ${role}';
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  REVOKE CONNECT ON DATABASE postgres FROM ${role};
  BEGIN
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA extensions FROM ${role}';
    EXECUTE 'REVOKE ALL ON SCHEMA extensions FROM ${role}';
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;

  REVOKE USAGE ON SCHEMA pg_catalog FROM ${role};
  REVOKE SELECT ON pg_class, pg_namespace, pg_index FROM ${role};
  REVOKE SELECT ON pg_stat_user_tables FROM ${role};
  REVOKE SELECT ON pg_extension FROM ${role};

  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE ${USER_SCHEMAS_SQL}
  LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM ${role}', s.nspname);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM ${role}', s.nspname);
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM ${role}', s.nspname);
  END LOOP;

  DROP ROLE ${role};
END
$vs$;
`.trim();
}

/**
 * Re-apply PG 17+ maintenance rights on vacuumshift (no-op on PG 15/16).
 * On PG 15+, configure maintenance_connection_vault_id with a postgres URI instead.
 */
export function grantVacuumshiftMaintenanceSql(role = VACUUMSHIFT_ROLE): string {
  const pg17Grants = grantPg17MaintenanceSql(role);
  return `
DO $vs$
DECLARE s record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    RAISE EXCEPTION 'role ${role} does not exist';
  END IF;

  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE ${USER_SCHEMAS_SQL}
  LOOP
    ${grantMonitoringOnSchemaSql(role)}
  END LOOP;

  ${pg17Grants}
END
$vs$;
`.trim();
}

export async function grantVacuumshiftMaintenance(
  accessToken: string,
  projectRef: string
): Promise<{ pgMajor: number | null }> {
  const versionRows = await runDatabaseQueryRead<{ server_version_num: string }>(
    accessToken,
    projectRef,
    `select current_setting('server_version_num') as server_version_num`
  ).catch(() => []);
  const versionNum = versionRows[0]?.server_version_num
    ? parseInt(versionRows[0].server_version_num, 10)
    : null;
  const pgMajor =
    versionNum != null && !Number.isNaN(versionNum)
      ? Math.floor(versionNum / 10000)
      : null;

  const query = grantVacuumshiftMaintenanceSql();
  try {
    await runDatabaseQuery(accessToken, projectRef, query);
  } catch (queryErr) {
    console.warn(
      `[import] ${projectRef} maintenance grant via query failed, trying cli/login-role:`,
      queryErr instanceof Error ? queryErr.message : queryErr
    );
    await createCliLoginRole(accessToken, projectRef, false);
    try {
      await runDatabaseQuery(accessToken, projectRef, query);
    } finally {
      await deleteCliLoginRole(accessToken, projectRef).catch(() => {});
    }
  }

  return { pgMajor };
}

export async function provisionVacuumshiftRole(
  accessToken: string,
  projectRef: string
): Promise<{ password: string }> {
  const password = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const query = createVacuumshiftRoleSql(password);

  let usedCli = false;
  try {
    await runDatabaseQuery(accessToken, projectRef, query);
    return { password };
  } catch (queryErr) {
    console.warn(
      `[import] ${projectRef} database/query failed, trying cli/login-role:`,
      queryErr instanceof Error ? queryErr.message : queryErr
    );
  }

  await createCliLoginRole(accessToken, projectRef, false);
  usedCli = true;
  try {
    await runDatabaseQuery(accessToken, projectRef, query);
    return { password };
  } finally {
    if (usedCli) {
      await deleteCliLoginRole(accessToken, projectRef).catch((err) => {
        console.warn(`[import] ${projectRef} cli/login-role cleanup:`, err);
      });
    }
  }
}

export async function dropVacuumshiftRole(
  accessToken: string,
  projectRef: string
): Promise<void> {
  const query = dropVacuumshiftRoleSql();
  try {
    await runDatabaseQuery(accessToken, projectRef, query);
  } catch (queryErr) {
    console.warn(
      `[import] ${projectRef} drop role via query failed, trying cli/login-role:`,
      queryErr instanceof Error ? queryErr.message : queryErr
    );
    await createCliLoginRole(accessToken, projectRef, false);
    try {
      await runDatabaseQuery(accessToken, projectRef, query);
    } finally {
      await deleteCliLoginRole(accessToken, projectRef).catch(() => {});
    }
  }
}
