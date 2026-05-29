'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { registerDatabase } from '@vacuumshift/shared';
import { createClient } from '@/lib/supabase/client';
import { toNewDatabasePreferences, type UserDefaultPreferences } from '@/lib/user-preferences';

export function RegisterForm({
  newDatabasePreferences,
}: {
  newDatabasePreferences: UserDefaultPreferences;
}) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [connectionString, setConnectionString] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
      const functionsUrl = `${url}/functions/v1`;

      const result = await registerDatabase(supabase, functionsUrl, key, {
        label,
        connectionString,
        preferences: toNewDatabasePreferences(newDatabasePreferences),
      });
      const q = result.initialJobId ? `?job=${result.initialJobId}` : '';
      router.push(`/databases/${result.databaseId}${q}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form id="add-database" onSubmit={onSubmit} className="card" style={{ marginTop: '1.5rem' }}>
      <h2>Add database</h2>
      <label>
        Label
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Production"
          required
        />
      </label>
      <label>
        Connection string
        <input
          value={connectionString}
          onChange={(e) => setConnectionString(e.target.value)}
          placeholder="postgresql://..."
          required
          type="password"
          autoComplete="off"
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={loading}>
        {loading ? 'Registering…' : 'Register'}
      </button>
      <p className="muted">
        An initial bloat check runs automatically. Keep <code>npm run dev:worker</code> running
        so the job is picked up within a few seconds. Adjust preferences per database after
        opening it.
      </p>
    </form>
  );
}
