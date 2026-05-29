import {
  createCliLoginRole,
  deleteCliLoginRole,
  runDatabaseQuery,
  runDatabaseQueryRead,
} from './supabase-management.ts';

export const INSTALL_PGSTATTUPLE_SQL = `
CREATE EXTENSION IF NOT EXISTS pgstattuple WITH SCHEMA extensions;
`.trim();

export const VERIFY_PGSTATTUPLE_EXTENSION_SQL = `
SELECT EXISTS (
  SELECT 1 FROM pg_extension WHERE extname = 'pgstattuple'
) AS installed;
`.trim();

export const VERIFY_PGSTATINDEX_SQL = `
SELECT coalesce(
  to_regprocedure('extensions.pgstatindex(oid)'),
  to_regprocedure('pgstatindex(oid)')
) IS NOT NULL AS available;
`.trim();

/** Let the vacuumshift monitoring role call pgstatindex after install. */
export const GRANT_PGSTAT_TO_VACUUMSHIFT_SQL = `
DO $vs$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vacuumshift') THEN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
      EXECUTE 'GRANT USAGE ON SCHEMA extensions TO vacuumshift';
      EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO vacuumshift';
    END IF;
  END IF;
END
$vs$;
`.trim();

export interface PgstattupleStatus {
  extensionInstalled: boolean;
  pgstatindexAvailable: boolean;
}

/** Management API may return booleans as true/false, t/f, or strings. */
function rowFlag(row: Record<string, unknown> | undefined): boolean {
  if (!row) return false;
  for (const value of Object.values(row)) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
      const s = value.toLowerCase();
      if (s === 't' || s === 'true' || s === '1') return true;
    }
  }
  return false;
}

async function queryPgstattupleStatus(
  accessToken: string,
  projectRef: string
): Promise<PgstattupleStatus> {
  try {
    const [extRows, pgstatRows] = await Promise.all([
      runDatabaseQueryRead<Record<string, unknown>>(
        accessToken,
        projectRef,
        VERIFY_PGSTATTUPLE_EXTENSION_SQL
      ),
      runDatabaseQueryRead<Record<string, unknown>>(
        accessToken,
        projectRef,
        VERIFY_PGSTATINDEX_SQL
      ),
    ]);
    return {
      extensionInstalled: rowFlag(extRows[0]),
      pgstatindexAvailable: rowFlag(pgstatRows[0]),
    };
  } catch (err) {
    console.warn(`[pgstattuple] ${projectRef} status query failed:`, err);
    return { extensionInstalled: false, pgstatindexAvailable: false };
  }
}

async function runInstallQueries(
  accessToken: string,
  projectRef: string
): Promise<void> {
  await runDatabaseQuery(accessToken, projectRef, INSTALL_PGSTATTUPLE_SQL);
  await runDatabaseQuery(accessToken, projectRef, GRANT_PGSTAT_TO_VACUUMSHIFT_SQL).catch(
    (err) => {
      console.warn(`[pgstattuple] ${projectRef} grant to vacuumshift:`, err);
    }
  );
}

export async function installPgstattupleExtension(
  accessToken: string,
  projectRef: string,
  options?: { installIfMissing?: boolean }
): Promise<PgstattupleStatus> {
  const installIfMissing = options?.installIfMissing !== false;

  let status = await queryPgstattupleStatus(accessToken, projectRef);

  if (!status.extensionInstalled && installIfMissing) {
    try {
      await runInstallQueries(accessToken, projectRef);
    } catch (queryErr) {
      console.warn(
        `[pgstattuple] ${projectRef} database/query failed, trying cli/login-role:`,
        queryErr instanceof Error ? queryErr.message : queryErr
      );
      await createCliLoginRole(accessToken, projectRef, false);
      try {
        await runInstallQueries(accessToken, projectRef);
      } finally {
        await deleteCliLoginRole(accessToken, projectRef).catch(() => {});
      }
    }
    status = await queryPgstattupleStatus(accessToken, projectRef);
  } else if (status.extensionInstalled && !status.pgstatindexAvailable) {
    await runDatabaseQuery(accessToken, projectRef, GRANT_PGSTAT_TO_VACUUMSHIFT_SQL).catch(
      (err) => {
        console.warn(`[pgstattuple] ${projectRef} grant to vacuumshift:`, err);
      }
    );
    status = await queryPgstattupleStatus(accessToken, projectRef);
  }

  return status;
}
