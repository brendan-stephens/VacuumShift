-- Reclaimable space (pgstattuple heap free_space + index bloat) for metrics chart.

alter table public.database_metrics
  add column if not exists reclaimable_bytes bigint;

comment on column public.database_metrics.reclaimable_bytes is
  'When pgstattuple is available: sum(heap free_space) + index bloat — recoverable via VACUUM FULL/repack/cluster and REINDEX.';
