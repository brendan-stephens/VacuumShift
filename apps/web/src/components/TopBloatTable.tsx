import { formatBytes } from '@/lib/format';
import type { WindowEstimateContext } from '@/lib/window-estimates';

export function TopBloatTable({
  rows,
  indexBloatEstimated,
  pgstattupleInstalled,
  estimate,
}: {
  rows: Array<{
    id: string;
    schema_name: string;
    object_name: string;
    kind: string;
    bloat_bytes: number | string;
    relation_bytes: number | string;
    bloat_pages?: number | string | null;
  }>;
  indexBloatEstimated: boolean;
  pgstattupleInstalled: boolean | null;
  estimate: WindowEstimateContext | null;
}) {
  if (!rows.length) {
    return <p className="muted">No bloat objects recorded.</p>;
  }

  return (
    <>
      {estimate && (
        <p className="muted bloat-estimate-banner">
          {estimate.ratePagesPerSec != null && estimate.ratePagesPerSec > 0 ? (
            <>
              At ~{estimate.ratePagesPerSec.toFixed(1)} pages/s cleanup, about{' '}
              <strong>{estimate.estimatedObjects}</strong> more object(s) may fit in the
              current window ({Math.round(estimate.remainingMs / 60_000)} min left).
            </>
          ) : (
            <>
              Using a planning rate until operations complete — up to{' '}
              <strong>{estimate.estimatedObjects}</strong> object(s) may fit in the window.
            </>
          )}{' '}
          Highlighted rows are within that estimate.
        </p>
      )}
      {indexBloatEstimated && !pgstattupleInstalled && (
        <p className="muted">Index rows use a btree page estimate (pgstattuple not installed).</p>
      )}
      <table>
        <thead>
          <tr>
            <th>Object</th>
            <th>Kind</th>
            <th>Bloat</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const key = `${o.schema_name}.${o.object_name}`;
            const actionable =
              estimate?.completableKeys.has(key) &&
              (o.kind === 'table' || o.kind === 'index');
            return (
              <tr
                key={o.id}
                className={actionable ? 'row-actionable' : undefined}
                title={
                  actionable
                    ? 'Estimated to complete in the current maintenance window'
                    : undefined
                }
              >
                <td>
                  {o.schema_name}.{o.object_name}
                </td>
                <td>{o.kind}</td>
                <td>{formatBytes(Number(o.bloat_bytes))}</td>
                <td>{formatBytes(Number(o.relation_bytes))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
