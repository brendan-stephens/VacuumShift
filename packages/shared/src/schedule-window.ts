/** Schedule shape used for window evaluation (DB rows + editor). */
export interface ScheduleWindowSpec {
  enabled: boolean;
  interval_count: number;
  interval_unit: 'day' | 'week' | 'month';
  days_of_week: number[];
  day_of_month: number | null;
  window_start_time: string;
  window_end_time: string;
  timezone: string;
}

export interface ActiveWindow {
  windowStart: Date;
  windowEnd: Date;
}

/** Normalize legacy 24:00 / 23:59 end-of-day values to midnight. */
export function parseTimeToMinutes(value: string): number {
  const v = value.trim();
  if (v === '24:00' || v === '24:00:00' || v.startsWith('23:59')) return 0;
  const [h, m] = v.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function windowWrapsPastMidnight(startTime: string, endTime: string): boolean {
  return parseTimeToMinutes(endTime) <= parseTimeToMinutes(startTime);
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  dow: number;
  minutes: number;
};

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const weekday = get('weekday');
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    dow: dowMap[weekday] ?? 0,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function utcFromZonedLocal(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minutes: number
): Date {
  let candidate = new Date(
    Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0)
  );
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(candidate, timeZone);
    const deltaMin =
      (year - p.year) * 525_600 +
      (month - p.month) * 43_200 +
      (day - p.day) * 1_440 +
      (minutes - p.minutes);
    if (deltaMin === 0) break;
    candidate = new Date(candidate.getTime() + deltaMin * 60_000);
  }
  return candidate;
}

function shiftZonedDay(parts: ZonedParts, timeZone: string, deltaDays: number): ZonedParts {
  const noon = utcFromZonedLocal(timeZone, parts.year, parts.month, parts.day, 12 * 60);
  return zonedParts(new Date(noon.getTime() + deltaDays * 86_400_000), timeZone);
}

function calendarMatches(
  schedule: ScheduleWindowSpec,
  year: number,
  month: number,
  day: number,
  dow: number
): boolean {
  const { interval_count, interval_unit, days_of_week, day_of_month } = schedule;
  const epochDay = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);

  if (interval_unit === 'day') {
    return epochDay % interval_count === 0;
  }

  if (interval_unit === 'week') {
    const weekIndex = Math.floor(epochDay / 7);
    if (weekIndex % interval_count !== 0) return false;
    return days_of_week.length > 0 && days_of_week.includes(dow);
  }

  if (interval_unit === 'month') {
    const monthIndex = year * 12 + (month - 1);
    if (monthIndex % interval_count !== 0) return false;
    const dom = day_of_month ?? 1;
    return day === dom;
  }

  return false;
}

function calendarMatchesParts(schedule: ScheduleWindowSpec, parts: ZonedParts): boolean {
  return calendarMatches(schedule, parts.year, parts.month, parts.day, parts.dow);
}

/** Returns the active maintenance window containing `now`, if any. */
export function getActiveWindow(
  schedule: ScheduleWindowSpec,
  now: Date = new Date()
): ActiveWindow | null {
  if (!schedule.enabled) return null;

  const parts = zonedParts(now, schedule.timezone);
  const startMin = parseTimeToMinutes(schedule.window_start_time);
  const endMin = parseTimeToMinutes(schedule.window_end_time);
  const overnight = endMin <= startMin;

  if (overnight) {
    if (parts.minutes >= startMin) {
      if (!calendarMatchesParts(schedule, parts)) return null;
      const next = shiftZonedDay(parts, schedule.timezone, 1);
      return {
        windowStart: utcFromZonedLocal(
          schedule.timezone,
          parts.year,
          parts.month,
          parts.day,
          startMin
        ),
        windowEnd: utcFromZonedLocal(
          schedule.timezone,
          next.year,
          next.month,
          next.day,
          endMin
        ),
      };
    }

    if (endMin > 0 && parts.minutes < endMin) {
      const prev = shiftZonedDay(parts, schedule.timezone, -1);
      if (!calendarMatchesParts(schedule, prev)) return null;
      return {
        windowStart: utcFromZonedLocal(
          schedule.timezone,
          prev.year,
          prev.month,
          prev.day,
          startMin
        ),
        windowEnd: utcFromZonedLocal(
          schedule.timezone,
          parts.year,
          parts.month,
          parts.day,
          endMin
        ),
      };
    }

    return null;
  }

  if (!calendarMatchesParts(schedule, parts)) return null;
  if (parts.minutes < startMin || parts.minutes >= endMin) return null;

  return {
    windowStart: utcFromZonedLocal(
      schedule.timezone,
      parts.year,
      parts.month,
      parts.day,
      startMin
    ),
    windowEnd: utcFromZonedLocal(
      schedule.timezone,
      parts.year,
      parts.month,
      parts.day,
      endMin
    ),
  };
}

export function remainingWindowMs(windowEnd: Date, now: Date = new Date()): number {
  return Math.max(0, windowEnd.getTime() - now.getTime());
}
