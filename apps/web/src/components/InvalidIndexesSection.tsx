import { formatBytes } from '@/lib/format';
import { formatMaintenanceTimestamp, type InvalidIndexRow } from '@/lib/index-maintenance';

export function InvalidIndexesSection({
  invalidIndexes,
}: {
  invalidIndexes: InvalidIndexRow[];
}) {
  return (
    <details
      className="section card collapsible-section"
      open={Boolean(invalidIndexes.length)}
    >
      <summary>
        <h2>
          Invalid Indexes
          {invalidIndexes.length > 0 && (
            <span className="badge failed" style={{ marginLeft: '0.5rem' }}>
              {invalidIndexes.length}
            </span>
          )}
        </h2>
      </summary>

      {!invalidIndexes.length ? (
        <p className="muted">No invalid indexes found on the latest check.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Index</th>
              <th>Table</th>
              <th>Size</th>
              <th>Parent last vacuum</th>
              <th>Parent last autovacuum</th>
            </tr>
          </thead>
          <tbody>
            {invalidIndexes.map((o) => {
              const meta = o.meta;
              return (
                <tr key={o.id}>
                  <td>
                    {o.schema_name}.{o.object_name}
                  </td>
                  <td>
                    {o.parent_schema && o.parent_table
                      ? `${o.parent_schema}.${o.parent_table}`
                      : '—'}
                  </td>
                  <td>{formatBytes(Number(o.relation_bytes))}</td>
                  <td>{formatMaintenanceTimestamp(meta?.parent_last_vacuum)}</td>
                  <td>{formatMaintenanceTimestamp(meta?.parent_last_autovacuum)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </details>
  );
}
