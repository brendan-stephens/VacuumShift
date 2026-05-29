'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type InstallPayload = {
  manual?: boolean;
  message?: string;
  extensionInstalled?: boolean;
  pgstatindexAvailable?: boolean;
  recheckQueued?: boolean;
  recheckError?: string;
  initialJobId?: string;
  dbUpdated?: boolean;
  detail?: string;
  error?: string;
};

export function InstallPgstattuplePanel({
  databaseId,
  supabaseProjectRef,
}: {
  databaseId: string;
  supabaseProjectRef: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  async function install() {
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');

      const res = await fetch(`${url}/functions/v1/install-pgstattuple`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publishableKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ databaseId, queueRecheck: true }),
      });
      const payload = (await res.json()) as InstallPayload;
      if (!res.ok) {
        throw new Error(payload.detail ?? payload.error ?? res.statusText);
      }

      if (payload.manual) {
        setDoneMessage(payload.message ?? 'Install manually in the SQL editor.');
        return;
      }

      const parts: string[] = [];

      if (payload.extensionInstalled) {
        setSynced(true);
        if (payload.pgstatindexAvailable) {
          parts.push('pgstattuple is installed and pgstatindex is available.');
        } else {
          parts.push(
            'pgstattuple is installed. Index bloat may use an estimate until pgstatindex is callable — run a bloat check (npm run worker:once).'
          );
        }
        if (payload.dbUpdated === false) {
          parts.push('Could not update dashboard status in the app database — reload the page in a moment.');
        }
      } else {
        parts.push(
          'Could not confirm pgstattuple in pg_extension via the Management API. If you installed it in SQL, run npm run worker:once to refresh status.'
        );
      }

      if (payload.recheckQueued) {
        parts.push('A new initial check was queued.');
        if (payload.initialJobId) {
          parts.push(`Job ${payload.initialJobId.slice(0, 8)}…`);
        }
      } else if (payload.recheckError) {
        parts.push(
          `Could not queue recheck: ${payload.recheckError}. Apply migration 20260521070000 or run supabase db reset.`
        );
      } else if (payload.extensionInstalled) {
        parts.push('Run npm run worker:once to refresh bloat metrics.');
      }

      setDoneMessage(parts.join(' '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setLoading(false);
    }
  }

  if (synced && doneMessage) {
    return (
      <div className="extension-install card">
        <h2 style={{ marginTop: 0 }}>pgstattuple extension</h2>
        <p className="muted" style={{ margin: 0 }}>
          {doneMessage}
        </p>
      </div>
    );
  }

  if (doneMessage && !synced) {
    return (
      <div className="extension-install card">
        <h2 style={{ marginTop: 0 }}>pgstattuple extension</h2>
        <p className="muted" style={{ margin: 0 }}>
          {doneMessage}
        </p>
        {supabaseProjectRef && (
          <button type="button" style={{ marginTop: '0.75rem' }} onClick={install} disabled={loading}>
            {loading ? 'Working…' : 'Try again'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="extension-install card">
      <h2 style={{ marginTop: 0 }}>pgstattuple extension</h2>
      <p className="muted">
        Accurate index bloat uses <code>pgstattuple</code> (provides{' '}
        <code>pgstatindex</code>). Without it, VacuumShift falls back to a btree page
        estimate that needs <code>pg_stats</code> and is less precise.
      </p>

      {supabaseProjectRef ? (
        <p className="muted">
          This project is linked to Supabase (<code>{supabaseProjectRef}</code>). Sync
          status from your project or install the extension with your saved Management API
          token.
        </p>
      ) : (
        <p className="muted">Run in the SQL editor as a superuser:</p>
      )}

      {!supabaseProjectRef && (
        <pre className="sql-snippet">
          CREATE EXTENSION IF NOT EXISTS pgstattuple WITH SCHEMA extensions;
        </pre>
      )}

      {error && <p className="error">{error}</p>}

      {supabaseProjectRef && (
        <button type="button" disabled={loading} onClick={install}>
          {loading ? 'Working…' : 'Install'}
        </button>
      )}
    </div>
  );
}
