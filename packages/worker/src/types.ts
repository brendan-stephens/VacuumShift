import type { BloatObjectKind, JobRunKind, JobStatus } from '@vacuumshift/shared';

export interface MonitoredDatabaseRow {
  id: string;
  label: string;
  connection_vault_id: string;
  maintenance_connection_vault_id?: string | null;
  paused: boolean;
}

export interface MaintenanceJobRow {
  id: string;
  database_id: string;
  kind: JobRunKind;
  status: JobStatus;
  window_started_at: string;
  window_ends_at: string;
  schedule_id?: string | null;
}

export interface BloatRow {
  schema_name: string;
  object_name: string;
  relation_bytes: string | number;
  bloat_bytes: string | number;
  bloat_pages: string | number | null;
  dead_tuple_estimate: string | number | null;
  free_bytes?: string | number | null;
  parent_schema?: string | null;
  parent_table?: string | null;
  idx_scan?: string | number | null;
  last_vacuum?: string | null;
  last_autovacuum?: string | null;
  last_analyze?: string | null;
  last_autoanalyze?: string | null;
  indisvalid?: boolean | null;
  indisunique?: boolean | null;
  indisprimary?: boolean | null;
  last_maintenance_at?: string | null;
}

export interface IndexMaintenanceEvent {
  schemaName: string;
  indexName: string;
  parentSchema: string;
  parentTable: string;
  valid: boolean;
  relationBytes: number;
  idxScan: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
  lastMaintenanceAt: string | null;
}

export interface CollectedBloatObject {
  kind: BloatObjectKind;
  schemaName: string;
  objectName: string;
  qualifiedName: string;
  relationBytes: number;
  bloatBytes: number;
  bloatPages: number | null;
  deadTupleEstimate: number | null;
  parentSchema?: string;
  parentTable?: string;
  meta?: Record<string, unknown>;
}

export interface BloatCheckResult {
  databaseSizeBytes: number;
  objects: CollectedBloatObject[];
  indexMaintenanceEvents: IndexMaintenanceEvent[];
  tableBloatBytes: number;
  indexBloatBytes: number;
  tableBloatPages: number;
  indexBloatPages: number;
  /** Sum of pgstattuple free_space on heaps (null if extension unavailable). */
  tableReclaimableBytes: number | null;
  /** tableReclaimableBytes + indexBloatBytes when pgstattuple available. */
  reclaimableBytes: number | null;
  pgstattupleInstalled: boolean;
  indexBloatEstimated: boolean;
}

export interface AutovacuumGlobalRow {
  name: string;
  setting: string;
  unit: string | null;
  context: string;
  source: string;
}

export interface AutovacuumTableRow {
  schema_name: string;
  table_name: string;
  reloptions: string[] | null;
  stat_snapshot: Record<string, unknown>;
}
