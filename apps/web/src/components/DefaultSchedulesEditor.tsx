'use client';

import { ToggleSwitch } from '@/components/ToggleSwitch';
import {
  INTERVAL_UNIT_OPTIONS,
  WEEKDAY_LABELS,
  formatScheduleSummary,
  getTimezoneOptions,
  newDefaultSchedule,
  scheduleDisplayName,
  type DefaultSchedule,
} from '@/lib/default-schedules';

const TIMEZONES = getTimezoneOptions();

export function DefaultSchedulesEditor({
  schedules,
  onChange,
}: {
  schedules: DefaultSchedule[];
  onChange: (schedules: DefaultSchedule[]) => void;
}) {
  function update(id: string, patch: Partial<DefaultSchedule>) {
    onChange(schedules.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function remove(id: string) {
    onChange(schedules.filter((s) => s.id !== id));
  }

  function add() {
    onChange([...schedules, newDefaultSchedule()]);
  }

  return (
    <div className="default-schedules">
      <div className="default-schedules-header">
        <h3>Maintenance Windows</h3>
        <button type="button" className="secondary" onClick={add}>
          Add window
        </button>
      </div>
      <p className="muted">
        Applied to newly added databases. Repeat interval, days, and local time window.
      </p>

      {!schedules.length ? (
        <p className="muted">No default windows — add one to schedule maintenance.</p>
      ) : (
        <ul className="schedule-list">
          {schedules.map((s, index) => (
            <li key={s.id} className="schedule-card">
              <div className="schedule-card-header">
                <ToggleSwitch
                  id={`${s.id}-enabled`}
                  compact
                  checked={s.enabled}
                  onChange={(enabled) => update(s.id, { enabled })}
                  label={scheduleDisplayName(s, index)}
                />
                <label className="schedule-name-field">
                  <span className="sr-only">Window name</span>
                  <input
                    type="text"
                    value={s.name}
                    placeholder={`Window ${index + 1}`}
                    onChange={(e) => update(s.id, { name: e.target.value })}
                  />
                </label>
                <button type="button" className="link-button" onClick={() => remove(s.id)}>
                  Remove
                </button>
              </div>
              <p className="muted schedule-summary">{formatScheduleSummary(s, index)}</p>

              <div className="schedule-interval">
                <span className="muted">Repeat every</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="schedule-interval-count"
                  value={s.interval_count}
                  onChange={(e) =>
                    update(s.id, {
                      interval_count: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                />
                <select
                  value={s.interval_unit}
                  onChange={(e) =>
                    update(s.id, {
                      interval_unit: e.target.value as DefaultSchedule['interval_unit'],
                      days_of_week:
                        e.target.value === 'week' && !s.days_of_week.length
                          ? [1]
                          : s.days_of_week,
                    })
                  }
                >
                  {INTERVAL_UNIT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              {s.interval_unit === 'week' && (
                <div className="schedule-weekdays">
                  <span className="muted">Repeat on</span>
                  <div className="weekday-buttons" role="group" aria-label="Days of week">
                    {WEEKDAY_LABELS.map((label, dow) => {
                      const on = s.days_of_week.includes(dow);
                      return (
                        <button
                          key={`${s.id}-${dow}`}
                          type="button"
                          className={`weekday-btn${on ? ' is-on' : ''}`}
                          aria-pressed={on}
                          onClick={() => {
                            const next = on
                              ? s.days_of_week.filter((d) => d !== dow)
                              : [...s.days_of_week, dow].sort((a, b) => a - b);
                            update(s.id, { days_of_week: next });
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {s.interval_unit === 'month' && (
                <label>
                  Day of month (1–28)
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={s.day_of_month}
                    onChange={(e) =>
                      update(s.id, {
                        day_of_month: Math.min(
                          28,
                          Math.max(1, Number(e.target.value) || 1)
                        ),
                      })
                    }
                  />
                </label>
              )}

              <div className="schedule-window">
                <div className="schedule-time-row">
                  <label className="schedule-time-field">
                    <span className="field-label">From</span>
                    <input
                      type="time"
                      value={s.window_start_time}
                      onChange={(e) =>
                        update(s.id, { window_start_time: e.target.value })
                      }
                    />
                  </label>
                  <span className="schedule-time-sep" aria-hidden>
                    –
                  </span>
                  <label className="schedule-time-field">
                    <span className="field-label">To</span>
                    <input
                      type="time"
                      value={s.window_end_time.slice(0, 5)}
                      onChange={(e) =>
                        update(s.id, { window_end_time: e.target.value })
                      }
                    />
                  </label>
                </div>
                <p className="muted schedule-window-hint">
                  If To is earlier than From, the window continues into the next day.
                </p>
                <label className="schedule-timezone-field">
                  <span className="field-label">Timezone</span>
                  <select
                    value={s.timezone}
                    onChange={(e) => update(s.id, { timezone: e.target.value })}
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
