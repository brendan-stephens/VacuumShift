import postgres from 'npm:postgres@3.4.5';

export interface ConnectionTestResult {
  ok: true;
  serverVersion: string;
}

export interface ConnectionTestFailure {
  ok: false;
  message: string;
}

export type ConnectionTestOutcome = ConnectionTestResult | ConnectionTestFailure;

/** Verify the connection string reaches a Postgres instance (SELECT version). */
export async function testPostgresConnection(
  connectionString: string,
  timeoutMs = 10_000
): Promise<ConnectionTestOutcome> {
  const connectTimeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const sql = postgres(connectionString, {
    connect_timeout: connectTimeoutSeconds,
    max: 1,
    idle_timeout: 1,
  });

  try {
    const [row] = await sql<{ version: string }[]>`
      select version() as version
    `;
    return {
      ok: true,
      serverVersion: row?.version ?? 'unknown',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
