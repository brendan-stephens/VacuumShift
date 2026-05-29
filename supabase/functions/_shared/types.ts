export type TableVacuumMode = 'vacuum' | 'vacuum_analyze';
export type IndexReindexMode = 'reindex' | 'reindex_concurrently';

export interface RegisterPreferencesInput {
  minTableSizeMb?: number;
  minIndexSizeMb?: number;
  tableVacuumMode?: TableVacuumMode;
  indexReindexMode?: IndexReindexMode;
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
