'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { createClient } from '@/lib/supabase/client';

export function DeleteDatabaseButton({
  databaseId,
  label,
  supabaseProjectRef,
  supabaseMonitoringRole,
}: {
  databaseId: string;
  label: string;
  supabaseProjectRef: string | null;
  supabaseMonitoringRole: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removeSupabaseRole, setRemoveSupabaseRole] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canRemoveSupabaseRole = Boolean(supabaseProjectRef && supabaseMonitoringRole);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  function closeModal() {
    if (loading) return;
    setOpen(false);
    setError(null);
    setRemoveSupabaseRole(true);
  }

  async function onDelete() {
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not signed in');

      if (canRemoveSupabaseRole && removeSupabaseRole) {
        const res = await fetch(`${url}/functions/v1/remove-supabase-monitoring-role`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: publishableKey,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ databaseId }),
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload.detail ?? payload.error ?? 'Failed to remove Supabase role');
        }
      }

      const { error: rpcError } = await supabase.rpc('delete_monitored_database', {
        p_database_id: databaseId,
      });
      if (rpcError) throw rpcError;
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="danger" onClick={() => setOpen(true)}>
        Remove database
      </button>

      <Modal open={open} title="Remove database" onClose={closeModal}>
        <p className="muted">
          Remove <strong>{label}</strong>? This deletes metrics, job history, and the stored
          connection string. This cannot be undone.
        </p>

        {canRemoveSupabaseRole && (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={removeSupabaseRole}
              onChange={(e) => setRemoveSupabaseRole(e.target.checked)}
              disabled={loading}
            />
            Also remove the <code>{supabaseMonitoringRole}</code> database user from this
            Supabase project
          </label>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="secondary" disabled={loading} onClick={closeModal}>
            Cancel
          </button>
          <button type="button" className="danger" disabled={loading} onClick={onDelete}>
            {loading ? 'Removing…' : 'Yes, remove'}
          </button>
        </div>
      </Modal>
    </>
  );
}
