import { pgstattupleWarningTitle } from '@/lib/pgstattuple';

export function PgstattupleWarning({
  indexBloatEstimated,
}: {
  indexBloatEstimated?: boolean | null;
}) {
  return (
    <span
      className="extension-warning"
      title={pgstattupleWarningTitle(indexBloatEstimated)}
      aria-label={pgstattupleWarningTitle(indexBloatEstimated)}
    >
      ⚠
    </span>
  );
}
