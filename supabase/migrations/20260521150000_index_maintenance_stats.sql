-- Index vacuum/autovacuum snapshot + optional bloat object metadata.

alter type public.autovacuum_scope add value if not exists 'index_maintenance';

alter table public.bloat_objects
  add column if not exists meta jsonb;

comment on column public.bloat_objects.meta is
  'Optional per-object snapshot fields (e.g. parent last_vacuum for invalid indexes).';
