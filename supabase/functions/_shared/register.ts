import type { RegisterPreferencesInput } from './types.ts';

export function preferencesToRpcJson(prefs?: RegisterPreferencesInput): Record<string, unknown> {
  if (!prefs) return {};
  const out: Record<string, unknown> = {};
  if (prefs.minTableSizeMb !== undefined) out.min_table_size_mb = prefs.minTableSizeMb;
  if (prefs.minIndexSizeMb !== undefined) out.min_index_size_mb = prefs.minIndexSizeMb;
  if (prefs.tableVacuumMode !== undefined) out.table_vacuum_mode = prefs.tableVacuumMode;
  if (prefs.indexReindexMode !== undefined) out.index_reindex_mode = prefs.indexReindexMode;
  if (prefs.pauseBetweenOpsMs !== undefined) out.pause_between_ops_ms = prefs.pauseBetweenOpsMs;
  if (prefs.excludePatterns !== undefined) out.exclude_patterns = prefs.excludePatterns;
  if (prefs.runInitialCheck !== undefined) out.run_initial_check = prefs.runInitialCheck;
  if (prefs.enforceTimeWindow !== undefined) out.enforce_time_window = prefs.enforceTimeWindow;
  return out;
}

export function validateRegisterRequest(
  body: unknown
): { ok: true; data: RegisterBody } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  const label = b.label;
  const connectionString = b.connectionString ?? b.connection_string;

  if (typeof label !== 'string' || label.trim().length === 0) {
    return { ok: false, error: 'label is required' };
  }
  if (typeof connectionString !== 'string' || connectionString.trim().length === 0) {
    return { ok: false, error: 'connectionString is required' };
  }
  if (!/^postgres(ql)?:\/\//i.test(connectionString.trim())) {
    return { ok: false, error: 'connectionString must be a postgres:// or postgresql:// URL' };
  }

  return {
    ok: true,
    data: {
      label: label.trim(),
      connectionString: connectionString.trim(),
      preferences: b.preferences as RegisterPreferencesInput | undefined,
      schedules: b.schedules as import('./types.ts').MaintenanceScheduleInput[] | undefined,
    },
  };
}

export function schedulesToRpcJson(
  schedules?: import('./types.ts').MaintenanceScheduleInput[]
): unknown[] | null {
  if (!schedules?.length) return null;
  return schedules;
}

export interface RegisterBody {
  label: string;
  connectionString: string;
  preferences?: RegisterPreferencesInput;
  schedules?: import('./types.ts').MaintenanceScheduleInput[];
}
