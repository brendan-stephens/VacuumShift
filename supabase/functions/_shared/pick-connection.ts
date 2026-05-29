import { debugLogConnection } from './connection-uri.ts';
import { testPostgresConnection } from './postgres.ts';

export async function pickWorkingConnection(
  projectRef: string,
  label: string,
  candidates: Array<{ connectionString: string; poolMode: string }>
): Promise<{ picked: { connectionString: string; poolMode: string } | null; error: string | null }> {
  const directModes = new Set(['direct', 'direct-user']);
  const mode = (c: { poolMode: string }) => c.poolMode.toLowerCase();
  const ordered = [
    ...candidates.filter((c) => mode(c) === 'session' && !directModes.has(mode(c))),
    ...candidates.filter((c) => mode(c) !== 'session' && !directModes.has(mode(c))),
    ...candidates.filter((c) => directModes.has(mode(c))),
  ];

  let connectError: string | null = null;
  for (const candidate of ordered) {
    debugLogConnection(`${projectRef} ${label} (${candidate.poolMode})`, candidate.connectionString);
    const test = await testPostgresConnection(candidate.connectionString);
    if (test.ok) {
      return { picked: candidate, error: null };
    }
    connectError = test.message;
  }
  return { picked: null, error: connectError };
}
