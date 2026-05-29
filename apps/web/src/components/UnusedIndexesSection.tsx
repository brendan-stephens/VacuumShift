import { formatBytes } from '@/lib/format';
import type { UnusedIndexRow } from '@/lib/index-maintenance';

export function UnusedIndexesSection({
  unusedIndexes,
}: {
  unusedIndexes: UnusedIndexRow[];
}) {
  return (
    <details className="section card collapsible-section">
      <summary>
        <h2>
          Unused Indexes
          {unusedIndexes.length > 0 && (
            <span className="badge" style={{ marginLeft: '0.5rem' }}>
              {unusedIndexes.length}
            </span>
          )}
        </h2>
      </summary>

      <p className="muted">
        Valid non-primary indexes with <code>idx_scan = 0</code> in{' '}
        <code>pg_stat_user_indexes</code> (since stats reset).<br></br>Unique indexes may
        still enforce constraints even when unused for reads.
      </p>

      {!unusedIndexes.length ? (
        <p className="muted">No unused indexes found on the latest check.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Index</th>
              <th>Table</th>
              <th>Unique</th>
              <th>Idx scans</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {unusedIndexes.map((o) => (
              <tr key={o.id}>
                <td>
                  {o.schema_name}.{o.object_name}
                </td>
                <td>
                  {o.parent_schema && o.parent_table
                    ? `${o.parent_schema}.${o.parent_table}`
                    : '—'}
                </td>
                <td>{o.meta?.is_unique ? 'yes' : 'no'}</td>
                <td>{(o.meta?.idx_scan ?? 0).toLocaleString()}</td>
                <td>{formatBytes(Number(o.relation_bytes))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
