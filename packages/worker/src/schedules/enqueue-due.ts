import type { SupabaseClient } from '@supabase/supabase-js';
import { getActiveWindow, type ScheduleWindowSpec } from '@vacuumshift/shared';

interface ScheduleRow {
  id: string;
  database_id: string;
  enabled: boolean;
  interval_count: number;
  interval_unit: 'day' | 'week' | 'month';
  days_of_week: number[];
  day_of_month: number | null;
  window_start_time: string;
  window_end_time: string | null;
  window_duration_minutes: number;
  timezone: string;
  recurrence: string;
  day_of_week: number | null;
}

function rowToSpec(row: ScheduleRow): ScheduleWindowSpec {
  let days_of_week = row.days_of_week ?? [];
  let day_of_month = row.day_of_month;
  let interval_unit = row.interval_unit;
  let interval_count = row.interval_count ?? 1;

  if (!interval_unit) {
    if (row.recurrence === 'daily') interval_unit = 'day';
    else if (row.recurrence === 'monthly') {
      interval_unit = 'month';
      day_of_month = day_of_month ?? 1;
    } else {
      interval_unit = 'week';
      if (!days_of_week.length && row.day_of_week != null) {
        days_of_week = [row.day_of_week];
      }
      if (!days_of_week.length) days_of_week = [1];
    }
  }

  let window_end_time = row.window_end_time;
  if (!window_end_time) {
    const start = row.window_start_time;
    const [h, m, s] = start.split(':').map(Number);
    const totalMin = h * 60 + (m || 0) + Math.floor((s || 0) / 60) + row.window_duration_minutes;
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    window_end_time = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
  }
  if (window_end_time >= '23:59:00') {
    window_end_time = '00:00:00';
  }

  return {
    enabled: row.enabled,
    interval_count,
    interval_unit,
    days_of_week,
    day_of_month,
    window_start_time: row.window_start_time,
    window_end_time,
    timezone: row.timezone,
  };
}

export async function enqueueDueScheduledJobs(supabase: SupabaseClient): Promise<number> {
  const { data: schedules, error } = await supabase
    .from('maintenance_schedules')
    .select(
      `
      id,
      database_id,
      enabled,
      interval_count,
      interval_unit,
      days_of_week,
      day_of_month,
      window_start_time,
      window_end_time,
      window_duration_minutes,
      timezone,
      recurrence,
      day_of_week,
      monitored_databases!inner ( paused )
    `
    )
    .eq('enabled', true);

  if (error) {
    console.error('[scheduler] list schedules failed:', error.message);
    throw error;
  }

  const now = new Date();
  let enqueued = 0;

  for (const raw of schedules ?? []) {
    const row = raw as ScheduleRow & { monitored_databases: { paused: boolean } };
    if (row.monitored_databases?.paused) continue;
    const spec = rowToSpec(row);
    const active = getActiveWindow(spec, now);
    if (!active) continue;

    const windowStartIso = active.windowStart.toISOString();
    const windowEndIso = active.windowEnd.toISOString();

    const windowStartLo = new Date(active.windowStart.getTime() - 2_000).toISOString();
    const windowStartHi = new Date(active.windowStart.getTime() + 2_000).toISOString();
    const { data: existing } = await supabase
      .from('maintenance_jobs')
      .select('id')
      .eq('schedule_id', row.id)
      .gte('window_started_at', windowStartLo)
      .lte('window_started_at', windowStartHi)
      .maybeSingle();

    if (existing) continue;

    const { data: busy } = await supabase
      .from('maintenance_jobs')
      .select('id')
      .eq('database_id', row.database_id)
      .in('status', ['pending', 'running'])
      .in('kind', ['scheduled', 'manual', 'initial'])
      .limit(1);

    if (busy?.length) continue;

    const { error: insertError } = await supabase.from('maintenance_jobs').insert({
      database_id: row.database_id,
      schedule_id: row.id,
      kind: 'scheduled',
      status: 'pending',
      window_started_at: windowStartIso,
      window_ends_at: windowEndIso,
    });

    if (insertError) {
      console.warn(
        `[scheduler] enqueue failed schedule=${row.id}:`,
        insertError.message
      );
      continue;
    }

    enqueued += 1;
    console.log(
      `[scheduler] queued scheduled job database=${row.database_id} schedule=${row.id}`
    );
  }

  return enqueued;
}
