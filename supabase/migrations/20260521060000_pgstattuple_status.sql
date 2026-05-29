-- Track pgstattuple availability and whether index bloat used the btree fallback estimate.

alter table public.monitored_databases
  add column if not exists pgstattuple_installed boolean,
  add column if not exists index_bloat_estimated boolean;

alter table public.database_metrics
  add column if not exists pgstattuple_installed boolean,
  add column if not exists index_bloat_estimated boolean;

comment on column public.monitored_databases.pgstattuple_installed is
  'Latest check: pgstattuple extension present on the monitored database.';
comment on column public.monitored_databases.index_bloat_estimated is
  'Latest check: index bloat came from btree page heuristic (no pgstatindex).';
