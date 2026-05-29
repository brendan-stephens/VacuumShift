'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/Modal';
import { createClient } from '@/lib/supabase/client';
import { DefaultSchedulesEditor } from '@/components/DefaultSchedulesEditor';
import { PreferenceFields } from '@/components/PreferenceFields';
import {
  scheduleToApiPayload,
  validateSchedules,
  type DefaultSchedule,
} from '@/lib/default-schedules';
import { accountSettingsKey } from '@/lib/form-reset-key';
import { preferencesToSaveRpc } from '@/lib/preferences-rpc';
import type { UserDefaultPreferences } from '@/lib/user-preferences';

function formatSaveError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message: string; details?: string; hint?: string; code?: string };
    let msg = e.message;
    if (e.details) msg += ` — ${e.details}`;
    if (
      e.code === 'PGRST202' ||
      e.code === 'PGRST205' ||
      /user_default_preferences|save_user_default_preferences|user_default_schedules|save_user_default_schedules/i.test(
        msg
      )
    ) {
      msg += '. Apply migrations: supabase db reset (local) or supabase migration up.';
    }
    return msg;
  }
  return 'Could not save preferences';
}

function PreferencesForm({
  initialPreferences,
  initialSchedules,
  onClose,
}: {
  initialPreferences: UserDefaultPreferences;
  initialSchedules: DefaultSchedule[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initialPreferences);
  const [schedules, setSchedules] = useState(initialSchedules);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const { error: saveError } = await supabase.rpc(
        'save_user_default_preferences',
        preferencesToSaveRpc(prefs)
      );
      if (saveError) throw saveError;

      const scheduleError = validateSchedules(schedules);
      if (scheduleError) throw new Error(scheduleError);

      const { error: schedulesSaveError } = await supabase.rpc('save_user_default_schedules', {
        p_schedules: scheduleToApiPayload(schedules),
      });
      if (schedulesSaveError) throw schedulesSaveError;

      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(formatSaveError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <p className="muted">
        Applied when you add a database (connection string or Supabase import). Existing
        databases are unchanged.
      </p>

      <form className="modal-form" onSubmit={onSave}>
        <PreferenceFields prefs={prefs} onChange={setPrefs} idPrefix="account-prefs" />

        <DefaultSchedulesEditor schedules={schedules} onChange={setSchedules} />

        {error && <p className="error">{error}</p>}
        {saved && <p className="muted">Saved.</p>}

        <div className="modal-actions">
          <button type="button" className="secondary" disabled={loading} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={loading}>
            {loading ? 'Saving…' : 'Save defaults'}
          </button>
        </div>
      </form>
    </>
  );
}

export function PreferencesModal({
  open,
  onClose,
  initialPreferences,
  initialSchedules,
}: {
  open: boolean;
  onClose: () => void;
  initialPreferences: UserDefaultPreferences;
  initialSchedules: DefaultSchedule[];
}) {
  const formKey = accountSettingsKey(initialPreferences, initialSchedules);

  return (
    <Modal open={open} title="Default preferences" onClose={onClose} className="preferences-modal">
      {open && (
        <PreferencesForm
          key={formKey}
          initialPreferences={initialPreferences}
          initialSchedules={initialSchedules}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
