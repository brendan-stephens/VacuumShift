'use client';

import { ExcludePatternsField } from '@/components/ExcludePatternsField';
import { ToggleSwitch } from '@/components/ToggleSwitch';
import {
  INDEX_REINDEX_MODE_OPTIONS,
  TABLE_VACUUM_MODE_OPTIONS,
  type IndexReindexMode,
  type TableVacuumMode,
  type UserDefaultPreferences,
} from '@/lib/user-preferences';

export function PreferenceFields({
  prefs,
  onChange,
  idPrefix = 'prefs',
}: {
  prefs: UserDefaultPreferences;
  onChange: (prefs: UserDefaultPreferences) => void;
  idPrefix?: string;
}) {
  return (
    <>
      <div className="preference-size-row">
        <label>
          Min table size (MB)
          <input
            type="number"
            min={0}
            step={1}
            value={prefs.min_table_size_mb}
            onChange={(e) =>
              onChange({
                ...prefs,
                min_table_size_mb: Math.max(0, Number(e.target.value) || 0),
              })
            }
          />
        </label>
        <label>
          Min index size (MB)
          <input
            type="number"
            min={0}
            step={1}
            value={prefs.min_index_size_mb}
            onChange={(e) =>
              onChange({
                ...prefs,
                min_index_size_mb: Math.max(0, Number(e.target.value) || 0),
              })
            }
          />
        </label>
      </div>

      <label>
        Table vacuum mode
        <select
          value={prefs.table_vacuum_mode}
          onChange={(e) =>
            onChange({
              ...prefs,
              table_vacuum_mode: e.target.value as TableVacuumMode,
            })
          }
        >
          {TABLE_VACUUM_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Index reindex mode
        <select
          value={prefs.index_reindex_mode}
          onChange={(e) =>
            onChange({
              ...prefs,
              index_reindex_mode: e.target.value as IndexReindexMode,
            })
          }
        >
          {INDEX_REINDEX_MODE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Pause between operations (ms)
        <input
          type="number"
          min={0}
          step={100}
          value={prefs.pause_between_ops_ms}
          onChange={(e) =>
            onChange({
              ...prefs,
              pause_between_ops_ms: Math.max(0, Number(e.target.value) || 0),
            })
          }
        />
      </label>

      <ExcludePatternsField
        patterns={prefs.exclude_patterns}
        onPatternsChange={(exclude_patterns) => onChange({ ...prefs, exclude_patterns })}
      />

      <ToggleSwitch
        id={`${idPrefix}-enforce-time-window`}
        checked={prefs.enforce_time_window}
        onChange={(enforce_time_window) =>
          onChange({ ...prefs, enforce_time_window })
        }
        label="Enforce maintenance window"
        description="Set statement_timeout on each operation so work stops at window end (+ 30s grace)."
      />
    </>
  );
}
