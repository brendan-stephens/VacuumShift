'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DefaultSchedulesEditor } from '@/components/DefaultSchedulesEditor';
import { PreferenceFields } from '@/components/PreferenceFields';
import type { DatabasePreferences } from '@/lib/database-preferences';
import { databaseSettingsKey } from '@/lib/form-reset-key';
import { preferencesToSaveRpc } from '@/lib/preferences-rpc';
import {
  scheduleToApiPayload,
  validateSchedules,
  type DefaultSchedule,
} from '@/lib/default-schedules';
import { createClient } from '@/lib/supabase/client';

function formatSaveError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message: string; details?: string; code?: string };
    let msg = e.message;
    if (e.details) msg += ` — ${e.details}`;
    if (
      e.code === 'PGRST202' ||
      /save_database_preferences|save_database_schedules|apply_user_defaults_to_database/i.test(
        msg
      )
    ) {
      msg += '. Apply migrations: supabase db reset (local) or supabase migration up.';
    }
    return msg;
  }
  return 'Could not save settings';
}

function DatabaseSettingsForm({
  databaseId,
  initialPreferences,
  initialSchedules,
}: {
  databaseId: string;
  initialPreferences: DatabasePreferences;
  initialSchedules: DefaultSchedule[];
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initialPreferences);
  const [schedules, setSchedules] = useState(initialSchedules);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const scheduleError = validateSchedules(schedules);
    if (scheduleError) {
      setError(scheduleError);
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: prefsError } = await supabase.rpc('save_database_preferences', {
        p_database_id: databaseId,
        ...preferencesToSaveRpc(prefs),
      });
      if (prefsError) throw prefsError;

      const { error: schedulesError } = await supabase.rpc('save_database_schedules', {
        p_database_id: databaseId,
        p_schedules: scheduleToApiPayload(schedules),
      });
      if (schedulesError) throw schedulesError;

      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(formatSaveError(err));
    } finally {
      setLoading(false);
    }
  }

  async function resetToAccountDefaults() {
    if (
      !confirm(
        'Replace this database’s preferences and maintenance windows with your account defaults?'
      )
    ) {
      return;
    }

    setError(null);
    setSaved(false);
    setResetting(true);
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.rpc('apply_user_defaults_to_database', {
        p_database_id: databaseId,
      });
      if (resetError) throw resetError;
      router.refresh();
    } catch (err) {
      setError(formatSaveError(err));
    } finally {
      setResetting(false);
    }
  }

  return (
    <details className="section card collapsible-section database-settings">
      <summary>
        <h2>Preferences &amp; Schedules</h2>
      </summary>
      <p className="muted">
        Settings for this database only. Account defaults apply when you add a new database;
        change them under Preferences on the home page.
      </p>

      <form className="modal-form database-settings-form" onSubmit={onSave}>
        <PreferenceFields prefs={prefs} onChange={setPrefs} idPrefix={`db-${databaseId}`} />
        <DefaultSchedulesEditor schedules={schedules} onChange={setSchedules} />

        {error && <p className="error">{error}</p>}
        {saved && <p className="muted">Saved.</p>}

        <div className="modal-actions database-settings-actions">
          <button
            type="button"
            className="secondary"
            disabled={loading || resetting}
            onClick={resetToAccountDefaults}
          >
            {resetting ? 'Resetting…' : 'Reset to account defaults'}
          </button>
          <button type="submit" disabled={loading || resetting}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </details>
  );
}

export function DatabaseSettingsPanel({
  databaseId,
  initialPreferences,
  initialSchedules,
}: {
  databaseId: string;
  initialPreferences: DatabasePreferences;
  initialSchedules: DefaultSchedule[];
}) {
  return (
    <DatabaseSettingsForm
      key={databaseSettingsKey(databaseId, initialPreferences, initialSchedules)}
      databaseId={databaseId}
      initialPreferences={initialPreferences}
      initialSchedules={initialSchedules}
    />
  );
}
