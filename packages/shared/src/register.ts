export interface RegisterPreferencesInput {
  minTableSizeMb?: number;
  minIndexSizeMb?: number;
  tableVacuumMode?: 'vacuum' | 'vacuum_analyze';
  indexReindexMode?: 'reindex' | 'reindex_concurrently';
  pauseBetweenOpsMs?: number;
  excludePatterns?: string[];
  runInitialCheck?: boolean;
  enforceTimeWindow?: boolean;
}

export interface MaintenanceScheduleInput {
  name?: string;
  enabled?: boolean;
  interval_count?: number;
  interval_unit?: 'day' | 'week' | 'month';
  days_of_week?: number[];
  day_of_month?: number | null;
  window_start_time?: string;
  window_end_time?: string;
  timezone?: string;
  sort_order?: number;
}

export interface RegisterDatabaseRequest {
  label: string;
  connectionString: string;
  preferences?: RegisterPreferencesInput;
  schedules?: MaintenanceScheduleInput[];
}

export interface RegisterDatabaseResponse {
  databaseId: string;
  connectionVaultId: string;
  initialJobId: string | null;
  serverVersion: string | null;
}

/** Map API camelCase preferences to RPC jsonb (snake_case). */
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

export function schedulesToRpcJson(
  schedules?: MaintenanceScheduleInput[]
): unknown[] | undefined {
  if (!schedules?.length) return undefined;
  return schedules;
}

export function validateRegisterRequest(
  body: unknown
): { ok: true; data: RegisterDatabaseRequest } | { ok: false; error: string } {
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
      schedules: b.schedules as MaintenanceScheduleInput[] | undefined,
    },
  };
}
