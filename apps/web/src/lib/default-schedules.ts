export type ScheduleIntervalUnit = 'day' | 'week' | 'month';

export interface DefaultSchedule {
  id: string;
  name: string;
  enabled: boolean;
  interval_count: number;
  interval_unit: ScheduleIntervalUnit;
  days_of_week: number[];
  day_of_month: number;
  window_start_time: string;
  window_end_time: string;
  timezone: string;
}

export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export const INTERVAL_UNIT_OPTIONS: { value: ScheduleIntervalUnit; label: string }[] = [
  { value: 'day', label: 'day' },
  { value: 'week', label: 'week' },
  { value: 'month', label: 'month' },
];

export function newDefaultSchedule(): DefaultSchedule {
  return {
    id: crypto.randomUUID(),
    name: 'Maintenance window',
    enabled: true,
    interval_count: 1,
    interval_unit: 'week',
    days_of_week: [1, 3, 5],
    day_of_month: 1,
    window_start_time: '02:00',
    window_end_time: '04:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

export function normalizeTimeForDb(value: string): string {
  const v = value.trim();
  if (v === '24:00' || v === '24:00:00' || v.startsWith('23:59')) return '00:00:00';
  if (/^\d{2}:\d{2}$/.test(v)) return `${v}:00`;
  return v;
}

export function normalizeTimeForInput(value: string): string {
  const v = value.trim();
  if (v === '24:00' || v.startsWith('23:59')) return '00:00';
  return v.slice(0, 5);
}

export function durationMinutes(start: string, end: string): number {
  const parse = (t: string) => {
    const input = normalizeTimeForInput(t);
    const [h, m] = input.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  let endM = parse(end);
  const startM = parse(start);
  if (endM <= startM) endM += 24 * 60;
  return Math.max(1, Math.round(endM - startM));
}

export function windowWraps(start: string, end: string): boolean {
  const parse = (t: string) => {
    const input = normalizeTimeForInput(t);
    const [h, m] = input.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  return parse(end) <= parse(start);
}

export function cloneSchedulesForOverride(schedules: DefaultSchedule[]): DefaultSchedule[] {
  return schedules.map((s) => ({ ...s, id: crypto.randomUUID() }));
}

export function scheduleDisplayName(s: DefaultSchedule, index: number): string {
  const trimmed = s.name.trim();
  return trimmed || `Window ${index + 1}`;
}

export function scheduleToApiPayload(schedules: DefaultSchedule[]) {
  return schedules.map((s, i) => ({
    name: s.name.trim(),
    enabled: s.enabled,
    interval_count: s.interval_count,
    interval_unit: s.interval_unit,
    days_of_week: s.interval_unit === 'week' ? s.days_of_week : [],
    day_of_month: s.interval_unit === 'month' ? s.day_of_month : null,
    window_start_time: normalizeTimeForDb(s.window_start_time),
    window_end_time: normalizeTimeForDb(s.window_end_time),
    timezone: s.timezone,
    sort_order: i,
  }));
}

function endTimeFromMaintenanceRow(row: {
  window_start_time: string;
  window_end_time?: string | null;
  window_duration_minutes: number;
}): string {
  if (row.window_end_time) return normalizeTimeForInput(row.window_end_time);
  const start = normalizeTimeForDb(row.window_start_time);
  const [h, m, s] = start.split(':').map(Number);
  const total = h * 60 + m + Math.floor((s || 0) / 60) + row.window_duration_minutes;
  if (total >= 24 * 60 - 1) return '00:00';
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/** Map a per-database maintenance_schedules row to the shared editor shape. */
export function maintenanceScheduleRowToDefaultSchedule(row: {
  id: string;
  name?: string | null;
  enabled: boolean;
  recurrence: string;
  timezone: string;
  window_start_time: string;
  window_end_time?: string | null;
  window_duration_minutes: number;
  interval_count?: number | null;
  interval_unit?: ScheduleIntervalUnit | null;
  days_of_week?: number[] | null;
  day_of_week?: number | null;
  day_of_month?: number | null;
}): DefaultSchedule {
  let interval_unit = row.interval_unit;
  let interval_count = row.interval_count ?? 1;
  let days_of_week = row.days_of_week ?? [];
  let day_of_month = row.day_of_month ?? 1;

  if (!interval_unit) {
    switch (row.recurrence) {
      case 'daily':
        interval_unit = 'day';
        break;
      case 'weekly':
        interval_unit = 'week';
        days_of_week =
          days_of_week.length > 0
            ? days_of_week
            : row.day_of_week != null
              ? [row.day_of_week]
              : [1];
        break;
      case 'monthly':
        interval_unit = 'month';
        day_of_month = row.day_of_month ?? 1;
        break;
      default:
        interval_unit = 'week';
        if (!days_of_week.length && row.day_of_week != null) {
          days_of_week = [row.day_of_week];
        }
        if (!days_of_week.length) days_of_week = [1];
    }
  }

  return rowToDefaultSchedule({
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    interval_count,
    interval_unit,
    days_of_week,
    day_of_month,
    window_start_time: row.window_start_time,
    window_end_time: endTimeFromMaintenanceRow(row),
    timezone: row.timezone,
  });
}

export function rowToDefaultSchedule(row: {
  id: string;
  name?: string | null;
  enabled: boolean;
  interval_count: number;
  interval_unit: ScheduleIntervalUnit;
  days_of_week: number[] | null;
  day_of_month: number | null;
  window_start_time: string;
  window_end_time: string;
  timezone: string;
}): DefaultSchedule {
  return {
    id: row.id,
    name: row.name?.trim() ?? '',
    enabled: row.enabled,
    interval_count: row.interval_count,
    interval_unit: row.interval_unit,
    days_of_week: row.days_of_week ?? [],
    day_of_month: row.day_of_month ?? 1,
    window_start_time: normalizeTimeForInput(row.window_start_time),
    window_end_time: normalizeTimeForInput(row.window_end_time),
    timezone: row.timezone,
  };
}

export function formatScheduleSummary(s: DefaultSchedule, index = 0): string {
  const title = scheduleDisplayName(s, index);
  const unit = s.interval_unit;
  const every =
    s.interval_count === 1 ? `Every ${unit}` : `Every ${s.interval_count} ${unit}s`;
  let days = '';
  if (unit === 'week' && s.days_of_week.length) {
    days = ` on ${s.days_of_week.map((d) => WEEKDAY_LABELS[d]).join(' ')}`;
  }
  if (unit === 'month') {
    days = ` on day ${s.day_of_month}`;
  }
  const start = normalizeTimeForInput(s.window_start_time);
  const end = normalizeTimeForInput(s.window_end_time);
  const wrap = windowWraps(s.window_start_time, s.window_end_time) ? ' (+1 day)' : '';
  return `${title}: ${every}${days}, ${start}–${end}${wrap} (${s.timezone})`;
}

export function getTimezoneOptions(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone').sort();
  } catch {
    return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London'];
  }
}

export function validateSchedules(schedules: DefaultSchedule[]): string | null {
  for (const s of schedules) {
    if (s.interval_count < 1) return 'Interval must be at least 1';
    if (s.interval_unit === 'week' && s.days_of_week.length === 0) {
      return 'Select at least one weekday for weekly schedules';
    }
    if (s.interval_unit === 'month' && (s.day_of_month < 1 || s.day_of_month > 28)) {
      return 'Day of month must be between 1 and 28';
    }
    if (normalizeTimeForInput(s.window_start_time) === normalizeTimeForInput(s.window_end_time)) {
      return 'Start and end time cannot be the same';
    }
  }
  return null;
}
