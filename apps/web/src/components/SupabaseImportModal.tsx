'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { createClient } from '@/lib/supabase/client';
import { toNewDatabasePreferences, type UserDefaultPreferences } from '@/lib/user-preferences';

interface SupabaseProjectRow {
  ref: string;
  name: string;
  region: string;
  status: string;
  runnable: boolean;
  alreadyMonitored: boolean;
}

function SupabaseImportForm({
  hasSavedToken,
  newDatabasePreferences,
}: {
  hasSavedToken: boolean;
  newDatabasePreferences: UserDefaultPreferences;
}) {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState('');
  const [saveToken, setSaveToken] = useState(true);
  const [projects, setProjects] = useState<SupabaseProjectRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [importingRefs, setImportingRefs] = useState<Set<string>>(() => new Set());
  const [importErrors, setImportErrors] = useState<Record<string, string>>({});
  const [importWarnings, setImportWarnings] = useState<Record<string, string>>({});
  const [projectFilter, setProjectFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    const q = projectFilter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.ref.toLowerCase().includes(q)
    );
  }, [projects, projectFilter]);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  async function authHeaders(): Promise<HeadersInit> {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Not signed in');
    return {
      'Content-Type': 'application/json',
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
    };
  }

  async function listProjects() {
    setError(null);
    setImportErrors({});
    setProjectFilter('');
    setLoading(true);
    setProjects([]);
    try {
      const res = await fetch(`${url}/functions/v1/list-supabase-projects`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          accessToken: accessToken.trim() || undefined,
          saveToken: saveToken && Boolean(accessToken.trim()),
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.detail ?? payload.error ?? res.statusText);
      }
      setProjects(payload.projects ?? []);
      if (payload.tokenSaved) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'List failed');
    } finally {
      setLoading(false);
    }
  }

  async function importProject(p: SupabaseProjectRow) {
    setError(null);
    setImportErrors((prev) => {
      const next = { ...prev };
      delete next[p.ref];
      return next;
    });
    setImportWarnings((prev) => {
      const next = { ...prev };
      delete next[p.ref];
      return next;
    });
    setImportingRefs((prev) => new Set(prev).add(p.ref));
    try {
      const res = await fetch(`${url}/functions/v1/import-supabase-databases`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          accessToken: accessToken.trim() || undefined,
          saveToken: false,
          projects: [
            {
              ref: p.ref,
              label: p.name,
              runInitialCheck: true,
            },
          ],
          preferences: toNewDatabasePreferences(newDatabasePreferences),
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.detail ?? payload.error ?? res.statusText);
      }

      const result = payload.results?.[0];
      if (result && !result.ok) {
        throw new Error(result.error ?? 'Import failed');
      }
      if (result?.warning) {
        setImportWarnings((prev) => ({ ...prev, [p.ref]: result.warning as string }));
      }

      setProjects((prev) =>
        prev.map((row) =>
          row.ref === p.ref ? { ...row, alreadyMonitored: true } : row
        )
      );
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      setImportErrors((prev) => ({ ...prev, [p.ref]: message }));
    } finally {
      setImportingRefs((prev) => {
        const next = new Set(prev);
        next.delete(p.ref);
        return next;
      });
    }
  }

  async function clearSavedToken() {
    const supabase = createClient();
    await supabase.rpc('clear_supabase_access_token');
    setAccessToken('');
    router.refresh();
  }

  return (
    <>
      <p className="muted">
        Your{' '}
        <a
          href="https://supabase.com/dashboard/account/tokens"
          target="_blank"
          rel="noreferrer"
        >
          personal access token
        </a>{' '}
        lists projects. Click Add to provision a <code>vacuumshift</code> role for checks.
        On Postgres 15/16, configure the <code>postgres</code> connection on the database page
        after import so VACUUM/REINDEX can run.
      </p>

      {hasSavedToken && (
        <p className="muted">
          A saved token is on file. Leave the field empty to use it, or paste a new one
          to replace.{' '}
          <button type="button" className="link-button" onClick={clearSavedToken}>
            Clear saved token
          </button>
        </p>
      )}

      <div className="modal-form">
        <label>
          Supabase access token (PAT)
          <input
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={hasSavedToken ? '•••••••• (optional)' : 'sbp_...'}
            autoComplete="off"
          />
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={saveToken}
            onChange={(e) => setSaveToken(e.target.checked)}
          />
          Remember token for future visits
        </label>

        <div className="modal-actions">
          <button type="button" onClick={listProjects} disabled={loading}>
            {loading ? 'Loading projects…' : 'List projects'}
          </button>
        </div>

        {projects.length > 0 && (
          <>
            <label>
              Filter projects
              <input
                type="search"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                placeholder="Search by name or ref…"
                autoComplete="off"
              />
            </label>

            <p className="muted project-list-hint">
              {filteredProjects.filter((p) => p.runnable && !p.alreadyMonitored).length}{' '}
              available
              {projectFilter.trim() &&
                ` · ${filteredProjects.length} of ${projects.length} shown`}
            </p>

            {filteredProjects.length === 0 ? (
              <p className="muted">No projects match your filter.</p>
            ) : (
            <ul className="project-list">
              {filteredProjects.map((p) => {
                const isImporting = importingRefs.has(p.ref);
                const canAdd = p.runnable && !p.alreadyMonitored && !isImporting;
                const rowError = importErrors[p.ref];
                const rowWarning = importWarnings[p.ref];

                return (
                  <li
                    key={p.ref}
                    className={`project-card${p.alreadyMonitored ? ' project-card-added' : ''}${!p.runnable ? ' project-card-unavailable' : ''}${rowError ? ' project-card-error' : ''}`}
                  >
                    <div className="project-card-body">
                      <div className="project-card-title">
                        <span className="project-name">{p.name}</span>
                        <span className={`badge project-status ${p.status.toLowerCase()}`}>
                          {p.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="project-meta">
                        <span className="project-ref">{p.ref}</span>
                        <span className="project-meta-sep">·</span>
                        {p.region}
                      </p>
                      {rowError && (
                        <p className="error project-card-error-msg">{rowError}</p>
                      )}
                      {rowWarning && !rowError && (
                        <p className="muted project-card-error-msg">{rowWarning}</p>
                      )}
                    </div>

                    <button
                      type="button"
                      className="project-add-btn"
                      disabled={!canAdd && !isImporting}
                      onClick={() => importProject(p)}
                    >
                      {isImporting
                        ? 'Provisioning…'
                        : p.alreadyMonitored
                          ? 'Added'
                          : !p.runnable
                            ? 'Unavailable'
                            : 'Add'}
                    </button>
                  </li>
                );
              })}
            </ul>
            )}
          </>
        )}

        {error && <p className="error">{error}</p>}
        <p className="muted">
          Adding a project queues an initial bloat check. Run <code>npm run dev:worker</code> to
          process it. Your PAT needs <strong>database write</strong> scope. Customize preferences
          and maintenance windows on the database page after import.
        </p>
      </div>
    </>
  );
}

export function SupabaseImportModal({
  open,
  onClose,
  hasSavedToken,
  newDatabasePreferences,
}: {
  open: boolean;
  onClose: () => void;
  hasSavedToken: boolean;
  newDatabasePreferences: UserDefaultPreferences;
}) {
  return (
    <Modal open={open} title="Import from Supabase" onClose={onClose}>
      {open && (
        <SupabaseImportForm
          hasSavedToken={hasSavedToken}
          newDatabasePreferences={newDatabasePreferences}
        />
      )}
    </Modal>
  );
}
