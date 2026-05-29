'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  formatGucValue,
  maintenanceGucsFromSnapshot,
  snapshotHasMaintenanceGucs,
  splitGlobalGucParameters,
  type PostgresGucParameter,
} from '@vacuumshift/shared';
import { CHECK_COMPLETED_EVENT } from '@/lib/check-events';
import { logClientFetchError } from '@/lib/fetch-errors';
import { createClient } from '@/lib/supabase/client';
import { formatTime } from '@/lib/format';

function GucTable({ parameters }: { parameters: PostgresGucParameter[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {parameters.map((p) => (
          <tr key={p.name}>
            <td>
              <code>{p.name}</code>
            </td>
            <td>{formatGucValue(p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GlobalConfigurationPanel({
  databaseId,
  initialCapturedAt,
  initialParameters,
}: {
  databaseId: string;
  initialCapturedAt: string | null;
  initialParameters: PostgresGucParameter[];
}) {
  const [capturedAt, setCapturedAt] = useState(initialCapturedAt);
  const [parameters, setParameters] = useState<PostgresGucParameter[]>(initialParameters);
  const [loading, setLoading] = useState(false);

  const reloadFromServer = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('autovacuum_settings')
        .select('captured_at, settings')
        .eq('database_id', databaseId)
        .eq('scope', 'global')
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('global configuration load', error);
        return;
      }

      if (!data) return;

      const next = (data.settings as { parameters?: PostgresGucParameter[] } | null)?.parameters;
      if (next?.length) {
        setCapturedAt(data.captured_at);
        setParameters(next);
      }
    } catch (err) {
      logClientFetchError('global configuration load', err);
    } finally {
      setLoading(false);
    }
  }, [databaseId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ databaseId: string }>).detail;
      if (detail?.databaseId === databaseId) {
        void reloadFromServer();
      }
    };
    window.addEventListener(CHECK_COMPLETED_EVENT, handler);
    return () => window.removeEventListener(CHECK_COMPLETED_EVENT, handler);
  }, [databaseId, reloadFromServer]);

  if (!parameters.length && !capturedAt) {
    return (
      <details className="section card collapsible-section">
        <summary>
          <h2>Global Configuration</h2>
        </summary>
        <p className="muted">Use Run now to collect autovacuum and maintenance settings.</p>
      </details>
    );
  }

  const { autovacuum } = splitGlobalGucParameters(parameters);
  const maintenance = maintenanceGucsFromSnapshot(parameters);
  const hasMaintenanceSnapshot = snapshotHasMaintenanceGucs(parameters);

  return (
    <details className="section card collapsible-section">
      <summary>
        <h2>Global Configuration</h2>
      </summary>
      <p className="muted">
        {capturedAt ? (
          <>
            Snapshot {formatTime(capturedAt)}
            {loading ? ' · refreshing…' : ''}. Use Run now to refresh global configuration.
          </>
        ) : (
          'Use Run now to refresh global configuration.'
        )}
      </p>

      {autovacuum.length > 0 && (
        <div className="guc-group">
          <h3 className="guc-group-title">Autovacuum</h3>
          <GucTable parameters={autovacuum} />
        </div>
      )}

      <div className="guc-group">
        <h3 className="guc-group-title">Maintenance &amp; indexing</h3>
        <p className="muted guc-group-hint">
          Read from <code>pg_settings</code> on each bloat check (same values as{' '}
          <code>SHOW</code> for these parameters). Affects VACUUM, REINDEX, and CREATE INDEX.
        </p>
        <GucTable parameters={maintenance} />
        {!hasMaintenanceSnapshot && (
          <p className="muted guc-group-hint">
            Values shown as — until the next Run now completes. Restart{' '}
            <code>npm run dev:worker</code> if you recently updated VacuumShift, then run
            again.
          </p>
        )}
      </div>
    </details>
  );
}
