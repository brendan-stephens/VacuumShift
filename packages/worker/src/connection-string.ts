import { isIpv6Host, normalizePostgresUri, parsePostgresUri } from '@vacuumshift/shared';

/**
 * Register stores URLs reachable from Edge (Docker). The worker runs on the host.
 */
export function connectionStringForHostRunner(connectionString: string): string {
  const uri = normalizePostgresUri(connectionString)
    .replace(/@host\.docker\.internal:/g, '@127.0.0.1:')
    .replace(/@host\.docker\.internal\//g, '@127.0.0.1/');

  const host = parsePostgresUri(uri)?.host;
  if (host && isIpv6Host(host)) {
    console.warn(
      '[worker] connection host is IPv6; if connect fails, re-import the project or save a pooler URI (Settings → Connect → Session pooler).'
    );
  }
  return uri;
}
