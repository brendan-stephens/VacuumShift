import type { DefaultSchedule } from '@/lib/default-schedules';

/** Stable key so keyed forms remount when server defaults change (avoids prop→state useEffect). */
export function accountSettingsKey(prefs: object, schedules: DefaultSchedule[]): string {
  return `${JSON.stringify(prefs)}:${schedules.map((s) => s.id).join(',')}`;
}

export function databaseSettingsKey(
  databaseId: string,
  prefs: object,
  schedules: DefaultSchedule[]
): string {
  return `${databaseId}:${accountSettingsKey(prefs, schedules)}`;
}
