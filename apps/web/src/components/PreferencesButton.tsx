'use client';

import { useState } from 'react';
import { PreferencesModal } from '@/components/PreferencesModal';
import type { DefaultSchedule } from '@/lib/default-schedules';
import type { UserDefaultPreferences } from '@/lib/user-preferences';

export function PreferencesButton({
  initialPreferences,
  initialSchedules,
}: {
  initialPreferences: UserDefaultPreferences;
  initialSchedules: DefaultSchedule[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        Preferences
      </button>
      <PreferencesModal
        open={open}
        onClose={() => setOpen(false)}
        initialPreferences={initialPreferences}
        initialSchedules={initialSchedules}
      />
    </>
  );
}
