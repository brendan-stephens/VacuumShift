'use client';

import { useMemo, useState } from 'react';
import { formatBytes, formatTime } from '@/lib/format';
import {
  formatMaintenanceTimestamp,
  type IndexMaintenanceEvent,
} from '@/lib/index-maintenance';

const PAGE_SIZE = 20;

function Pager({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="table-pager">
      <button
        type="button"
        className="secondary"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </button>
      <span className="muted">
        Page {page + 1} of {totalPages} ({total} indexes)
      </span>
      <button
        type="button"
        className="secondary"
        disabled={page >= totalPages - 1}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

export function IndexMaintenanceSection({
  events,
  capturedAt,
}: {
  events: IndexMaintenanceEvent[];
  capturedAt: string | null;
}) {
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const pageEvents = useMemo(() => {
    const start = page * PAGE_SIZE;
    return events.slice(start, start + PAGE_SIZE);
  }, [events, page]);

  return (
    <details className="section card collapsible-section">
      <summary>
        <h2>Maintenance History</h2>
      </summary>
      {capturedAt && (
        <p className="muted">
          Snapshot {formatTime(capturedAt)}. Parent-table <code>last_vacuum</code> /{' '}
          <code>last_autovacuum</code> from <code>pg_stat_user_tables</code> (since stats
          reset).
        </p>
      )}
      {!events.length ? (
        <p className="muted">No index maintenance stats yet — run a bloat check to collect them.</p>
      ) : (
        <>
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Index</th>
                <th>Table</th>
                <th>Valid</th>
                <th>Last vacuum</th>
                <th>Last autovacuum</th>
                <th>Last analyze</th>
                <th>Idx scans</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {pageEvents.map((e) => (
                <tr
                  key={`${e.schemaName}.${e.indexName}`}
                  className={e.valid ? '' : 'row-invalid'}
                >
                  <td>
                    {e.schemaName}.{e.indexName}
                  </td>
                  <td>
                    {e.parentSchema}.{e.parentTable}
                  </td>
                  <td>{e.valid ? 'yes' : 'no'}</td>
                  <td>{formatMaintenanceTimestamp(e.lastVacuum)}</td>
                  <td>{formatMaintenanceTimestamp(e.lastAutovacuum)}</td>
                  <td>
                    {formatMaintenanceTimestamp(e.lastAutoanalyze ?? e.lastAnalyze)}
                  </td>
                  <td>{e.idxScan.toLocaleString()}</td>
                  <td>{formatBytes(e.relationBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pager
            page={page}
            totalPages={totalPages}
            total={events.length}
            onPage={setPage}
          />
        </>
      )}
    </details>
  );
}
