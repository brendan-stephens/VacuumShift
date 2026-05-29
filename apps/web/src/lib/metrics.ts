import type { MetricPoint } from '@/components/MetricsChart';

export interface DatabaseMetricRow {
  captured_at: string;
  database_size_bytes: number | string;
  table_bloat_bytes: number | string;
  index_bloat_bytes: number | string;
  reclaimable_bytes?: number | string | null;
  pgstattuple_installed?: boolean | null;
}

export function metricsToChartPoints(metrics: DatabaseMetricRow[]): MetricPoint[] {
  return metrics.map((m) => {
    const tableBloatGb = Number(m.table_bloat_bytes) / 1024 ** 3;
    const indexBloatGb = Number(m.index_bloat_bytes) / 1024 ** 3;
    const reclaimable =
      m.reclaimable_bytes != null ? Number(m.reclaimable_bytes) / 1024 ** 3 : null;
    return {
      at: m.captured_at,
      sizeGb: Number(m.database_size_bytes) / 1024 ** 3,
      tableBloatGb,
      indexBloatGb,
      totalBloatGb: tableBloatGb + indexBloatGb,
      reclaimableGb: reclaimable,
    };
  });
}

export function metricsHaveReclaimable(metrics: DatabaseMetricRow[]): boolean {
  return metrics.some((m) => m.reclaimable_bytes != null);
}

export function latestBloatStats(latest: DatabaseMetricRow | undefined) {
  if (!latest) return null;
  const tableBloat = Number(latest.table_bloat_bytes);
  const indexBloat = Number(latest.index_bloat_bytes);
  const reclaimable =
    latest.reclaimable_bytes != null ? Number(latest.reclaimable_bytes) : null;
  return {
    size: Number(latest.database_size_bytes),
    tableBloat,
    indexBloat,
    totalBloat: tableBloat + indexBloat,
    reclaimable,
  };
}
