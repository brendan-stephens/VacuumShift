export function needsPgstattupleWarning(
  pgstattupleInstalled: boolean | null | undefined
): boolean {
  return pgstattupleInstalled === false;
}

export function pgstattupleWarningTitle(
  indexBloatEstimated: boolean | null | undefined
): string {
  if (indexBloatEstimated) {
    return 'pgstattuple is not installed — index bloat uses a btree page estimate';
  }
  return 'pgstattuple is not installed — install for accurate index bloat';
}
