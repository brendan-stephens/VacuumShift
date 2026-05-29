'use client';

import { Fragment, useState } from 'react';
import { formatBytes, formatTime } from '@/lib/format';

export interface JobHistoryRow {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  objects_completed: number;
  objects_queued: number;
  cleanup_rate_pages_per_sec?: number | null;
  estimated_objects_completable?: number | null;
  error_message: string | null;
  maintenance_operations?: OperationRow[];
}

export interface OperationRow {
  id: string;
  kind: string;
  schema_name: string;
  object_name: string;
  operation: string;
  status: string;
  duration_ms: number | null;
  bloat_pages_before: number | null;
  bloat_pages_after: number | null;
  pages_reclaimed: number | null;
  cleanup_rate_pages_per_sec: number | null;
  error_message: string | null;
  sort_order: number;
}

export function JobHistorySection({ jobs }: { jobs: JobHistoryRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!jobs.length) {
    return <p className="muted">No jobs yet.</p>;
  }

  return (
    <div className="table-scroll">
    <table className="job-history-table">
      <thead>
        <tr>
          <th aria-label="Expand" />
          <th>Kind</th>
          <th>Status</th>
          <th>Started</th>
          <th>Finished</th>
          <th>Objects</th>
          <th>Rate</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((j) => {
          const ops = j.maintenance_operations ?? [];
          const hasOps = ops.length > 0;
          const expanded = expandedId === j.id;
          return (
            <Fragment key={j.id}>
              <tr>
                <td>
                  {hasOps ? (
                    <button
                      type="button"
                      className="link-button job-expand-btn"
                      aria-expanded={expanded}
                      onClick={() => setExpandedId(expanded ? null : j.id)}
                    >
                      {expanded ? '−' : '+'}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{j.kind}</td>
                <td>
                  <span className={`badge ${j.status}`}>{j.status}</span>
                </td>
                <td>{j.started_at ? formatTime(j.started_at) : '—'}</td>
                <td>{j.finished_at ? formatTime(j.finished_at) : '—'}</td>
                <td>
                  {j.objects_completed}/{j.objects_queued}
                  {j.estimated_objects_completable != null &&
                    j.kind !== 'initial' &&
                    ` (est. ${j.estimated_objects_completable})`}
                </td>
                <td>
                  {j.cleanup_rate_pages_per_sec != null
                    ? `${Number(j.cleanup_rate_pages_per_sec).toFixed(1)} pg/s`
                    : '—'}
                </td>
              </tr>
              {expanded && hasOps && (
                <tr className="job-operations-row">
                  <td colSpan={7}>
                    <div className="table-scroll">
                    <table className="job-operations-table">
                      <thead>
                        <tr>
                          <th>Object</th>
                          <th>Op</th>
                          <th>Status</th>
                          <th>Duration</th>
                          <th>Pages</th>
                          <th>Reclaimed</th>
                          <th>Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...ops]
                          .sort((a, b) => a.sort_order - b.sort_order)
                          .map((op) => (
                            <tr key={op.id}>
                              <td>
                                {op.schema_name}.{op.object_name}
                              </td>
                              <td>{op.operation}</td>
                              <td>
                                <span className={`badge ${op.status}`}>{op.status}</span>
                              </td>
                              <td>
                                {op.duration_ms != null
                                  ? `${(op.duration_ms / 1000).toFixed(1)}s`
                                  : '—'}
                              </td>
                              <td>
                                {op.bloat_pages_before != null && op.bloat_pages_after != null
                                  ? `${op.bloat_pages_before} → ${op.bloat_pages_after}`
                                  : '—'}
                              </td>
                              <td>
                                {op.pages_reclaimed != null
                                  ? formatBytes(op.pages_reclaimed * 8192)
                                  : '—'}
                              </td>
                              <td>
                                {op.cleanup_rate_pages_per_sec != null
                                  ? `${Number(op.cleanup_rate_pages_per_sec).toFixed(1)} pg/s`
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    </div>
                    {ops.some((o) => o.error_message) && (
                      <p className="error" style={{ marginTop: '0.5rem' }}>
                        {ops.find((o) => o.error_message)?.error_message}
                      </p>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
