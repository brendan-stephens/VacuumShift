'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function MaintenanceConnectionPanel({
  databaseId,
  hasMaintenanceConnection,
  supabaseProjectRef,
  monitoringRole,
}: {
  databaseId: string;
  hasMaintenanceConnection: boolean;
  supabaseProjectRef: string | null;
  monitoringRole: string | null;
}) {
  const router = useRouter();
  const [databasePassword, setDatabasePassword] = useState('');
  const [connectionString, setConnectionString] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const needsPostgres =
    !hasMaintenanceConnection &&
    (monitoringRole === 'vacuumshift' || Boolean(supabaseProjectRef));

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const password = databasePassword.trim();
    const uri = connectionString.trim();
    if (!password && !uri) {
      setError('Enter your database password or a postgres connection URI.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Not signed in');

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

      const res = await fetch(`${url}/functions/v1/configure-maintenance-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: publishableKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          databaseId,
          databasePassword: password || undefined,
          connectionString: uri || undefined,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.detail ?? payload.error ?? res.statusText);
      }

      setSaved(true);
      setDatabasePassword('');
      setConnectionString('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  if (!needsPostgres && hasMaintenanceConnection) {
    return (
      <p className="muted" style={{ marginTop: '0.5rem' }}>
        Maintenance connection configured (postgres or privileged role).
      </p>
    );
  }

  return (
    <div className="maintenance-connection-panel">
      {needsPostgres && (
        <p className="error" style={{ marginBottom: '0.75rem' }}>
          Failed with &quot;permission denied&quot; using the{' '}
          <code>{monitoringRole ?? 'monitoring'}</code> role?<br></br> Add a{' '}
          <strong>postgres</strong> connection below (Supabase: Settings → Database password).
        </p>
      )}

      <form className="modal-form" onSubmit={onSave}>
        {supabaseProjectRef ? (
          <label>
            Database password (postgres)
            <input
              type="password"
              value={databasePassword}
              onChange={(e) => setDatabasePassword(e.target.value)}
              placeholder="From Supabase project settings"
              autoComplete="off"
            />
          </label>
        ) : null}

        <label>
          {supabaseProjectRef ? 'Or paste connection URI' : 'Postgres connection URI'}
          <input
            type="password"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            placeholder="postgresql://postgres:…@host:5432/postgres"
            autoComplete="off"
          />
        </label>

        {error && <p className="error">{error}</p>}
        {saved && <p className="muted">Maintenance connection saved.</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Testing & saving…' : 'Save maintenance connection'}
        </button>
      </form>
    </div>
  );
}
