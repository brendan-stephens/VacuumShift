/** Curated global GUCs for manual maintenance (VACUUM / REINDEX / CREATE INDEX). */
export const MAINTENANCE_INDEX_GUC_NAMES = [
  'maintenance_work_mem',
  'max_parallel_maintenance_workers',
  'max_parallel_workers',
] as const;

export type MaintenanceIndexGucName = (typeof MAINTENANCE_INDEX_GUC_NAMES)[number];

/** Extra vacuum-related globals collected alongside autovacuum%. */
export const VACUUM_GLOBAL_GUC_NAMES = [
  'vacuum_cost_delay',
  'vacuum_cost_limit',
  'vacuum_freeze_min_age',
  'vacuum_freeze_table_age',
  'vacuum_multixact_freeze_min_age',
  'vacuum_multixact_freeze_table_age',
] as const;

export interface PostgresGucParameter {
  name: string;
  setting: string;
  unit: string | null;
}

const maintenanceNameSet = new Set<string>(MAINTENANCE_INDEX_GUC_NAMES);

export function splitGlobalGucParameters(parameters: PostgresGucParameter[]): {
  autovacuum: PostgresGucParameter[];
  maintenance: PostgresGucParameter[];
} {
  const autovacuum: PostgresGucParameter[] = [];
  const maintenance: PostgresGucParameter[] = [];

  for (const p of parameters) {
    if (maintenanceNameSet.has(p.name)) {
      maintenance.push(p);
    } else {
      autovacuum.push(p);
    }
  }

  const order = new Map(MAINTENANCE_INDEX_GUC_NAMES.map((n, i) => [n, i]));
  maintenance.sort(
    (a, b) => (order.get(a.name as MaintenanceIndexGucName) ?? 99) - (order.get(b.name as MaintenanceIndexGucName) ?? 99)
  );

  return { autovacuum, maintenance };
}

export function formatGucValue(p: PostgresGucParameter): string {
  if (p.setting === '—') return '—';
  return p.unit ? `${p.setting} ${p.unit}` : p.setting;
}

/** Always return the maintenance GUC rows (placeholders when not in snapshot yet). */
export function maintenanceGucsFromSnapshot(
  parameters: PostgresGucParameter[]
): PostgresGucParameter[] {
  const byName = new Map(parameters.map((p) => [p.name, p]));
  return MAINTENANCE_INDEX_GUC_NAMES.map((name) => {
    const found = byName.get(name);
    if (found) return found;
    return { name, setting: '—', unit: null };
  });
}

export function snapshotHasMaintenanceGucs(parameters: PostgresGucParameter[]): boolean {
  const names = new Set(parameters.map((p) => p.name));
  return MAINTENANCE_INDEX_GUC_NAMES.some((n) => names.has(n));
}
