-- VacuumShift: monitored Postgres instances, schedules, bloat metrics, maintenance jobs

-- Extensions
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.schedule_recurrence as enum (
  'daily',
  'weekly',
  'monthly',
  'bespoke'
);

create type public.table_vacuum_mode as enum (
  'vacuum',
  'vacuum_analyze'
);

create type public.index_reindex_mode as enum (
  'reindex',
  'reindex_concurrently'
);

create type public.bloat_object_kind as enum (
  'table',
  'index'
);

create type public.job_status as enum (
  'pending',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled'
);

create type public.job_run_kind as enum (
  'scheduled',
  'initial',
  'manual'
);

create type public.autovacuum_scope as enum (
  'global',
  'table'
);

-- ---------------------------------------------------------------------------
-- Monitored databases (connection string stored in Vault, not in plain text)
-- ---------------------------------------------------------------------------

create table public.monitored_databases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  -- Supabase Vault secret name or id; worker resolves at runtime
  connection_vault_id text not null,
  paused boolean not null default false,
  last_health_at timestamptz,
  last_health_ok boolean,
  last_health_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index monitored_databases_user_id_idx on public.monitored_databases (user_id);

-- ---------------------------------------------------------------------------
-- Per-database maintenance preferences
-- ---------------------------------------------------------------------------

create table public.database_preferences (
  database_id uuid primary key references public.monitored_databases (id) on delete cascade,
  min_table_size_mb integer not null default 0 check (min_table_size_mb >= 0),
  min_index_size_mb integer not null default 0 check (min_index_size_mb >= 0),
  table_vacuum_mode public.table_vacuum_mode not null default 'vacuum',
  index_reindex_mode public.index_reindex_mode not null default 'reindex',
  pause_between_ops_ms integer not null default 0 check (pause_between_ops_ms >= 0),
  -- POSIX regex patterns; matched against schema.object (tables) or index name
  exclude_patterns text[] not null default '{}',
  run_initial_check boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Maintenance windows / schedules
-- ---------------------------------------------------------------------------

create table public.maintenance_schedules (
  id uuid primary key default gen_random_uuid(),
  database_id uuid not null references public.monitored_databases (id) on delete cascade,
  recurrence public.schedule_recurrence not null,
  enabled boolean not null default true,
  timezone text not null default 'UTC',
  -- For daily/weekly/monthly: local time-of-day in `timezone`
  window_start_time time not null default '02:00',
  window_duration_minutes integer not null default 120 check (window_duration_minutes > 0),
  -- Weekly: 0=Sunday .. 6=Saturday (ISO weekday-1 style, document in app)
  day_of_week smallint check (day_of_week between 0 and 6),
  -- Monthly: 1-28 (cap at 28 to avoid month-end gaps)
  day_of_month smallint check (day_of_month between 1 and 28),
  -- Bespoke: explicit cron (5-field) overrides recurrence fields when set
  cron_expression text,
  -- Bespoke one-off or bounded ranges (optional)
  bespoke_starts_at timestamptz,
  bespoke_ends_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_recurrence_fields check (
    (recurrence = 'bespoke' and cron_expression is not null)
    or (recurrence in ('daily', 'weekly', 'monthly'))
  ),
  constraint schedule_weekly_day check (
    recurrence <> 'weekly' or day_of_week is not null
  ),
  constraint schedule_monthly_day check (
    recurrence <> 'monthly' or day_of_month is not null
  )
);

create index maintenance_schedules_database_id_idx on public.maintenance_schedules (database_id);
create index maintenance_schedules_next_run_at_idx on public.maintenance_schedules (next_run_at)
  where enabled = true;

-- ---------------------------------------------------------------------------
-- Time-series: database size + aggregate bloat (dashboard graphs)
-- ---------------------------------------------------------------------------

create table public.database_metrics (
  id uuid primary key default gen_random_uuid(),
  database_id uuid not null references public.monitored_databases (id) on delete cascade,
  captured_at timestamptz not null default now(),
  database_size_bytes bigint not null,
  table_bloat_bytes bigint not null default 0,
  index_bloat_bytes bigint not null default 0,
  table_bloat_pages bigint,
  index_bloat_pages bigint,
  source text not null default 'check' -- check | post_job
);

create index database_metrics_database_captured_idx
  on public.database_metrics (database_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Per-object bloat snapshots (feeds prioritization: largest first)
-- ---------------------------------------------------------------------------

create table public.bloat_objects (
  id uuid primary key default gen_random_uuid(),
  database_id uuid not null references public.monitored_databases (id) on delete cascade,
  metrics_id uuid references public.database_metrics (id) on delete set null,
  captured_at timestamptz not null default now(),
  kind public.bloat_object_kind not null,
  schema_name text not null,
  object_name text not null,
  -- Qualified name for display / matching excludes
  qualified_name text generated always as (schema_name || '.' || object_name) stored,
  relation_bytes bigint not null,
  bloat_bytes bigint not null,
  bloat_pages bigint,
  dead_tuple_estimate bigint,
  -- For indexes: parent table
  parent_schema text,
  parent_table text
);

create index bloat_objects_database_captured_idx
  on public.bloat_objects (database_id, captured_at desc);
create index bloat_objects_bloat_bytes_idx
  on public.bloat_objects (database_id, bloat_bytes desc);

-- ---------------------------------------------------------------------------
-- Maintenance job runs (one per schedule window execution)
-- ---------------------------------------------------------------------------

create table public.maintenance_jobs (
  id uuid primary key default gen_random_uuid(),
  database_id uuid not null references public.monitored_databases (id) on delete cascade,
  schedule_id uuid references public.maintenance_schedules (id) on delete set null,
  kind public.job_run_kind not null default 'scheduled',
  status public.job_status not null default 'pending',
  window_started_at timestamptz not null,
  window_ends_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  -- Planning / progress
  objects_queued integer not null default 0,
  objects_completed integer not null default 0,
  pages_before bigint,
  pages_after bigint,
  pages_reclaimed bigint,
  cleanup_rate_pages_per_sec numeric(12, 4),
  estimated_objects_completable integer,
  estimated_pages_completable bigint,
  error_message text,
  created_at timestamptz not null default now()
);

create index maintenance_jobs_database_started_idx
  on public.maintenance_jobs (database_id, started_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Individual operations within a job (vacuum / reindex)
-- ---------------------------------------------------------------------------

create table public.maintenance_operations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.maintenance_jobs (id) on delete cascade,
  kind public.bloat_object_kind not null,
  schema_name text not null,
  object_name text not null,
  operation text not null, -- vacuum | vacuum_analyze | reindex | reindex_concurrently
  status public.job_status not null default 'pending',
  bloat_bytes_before bigint,
  bloat_pages_before bigint,
  bloat_bytes_after bigint,
  bloat_pages_after bigint,
  pages_reclaimed bigint,
  cleanup_rate_pages_per_sec numeric(12, 4),
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  error_message text,
  sort_order integer not null default 0
);

create index maintenance_operations_job_id_idx on public.maintenance_operations (job_id);

-- ---------------------------------------------------------------------------
-- Autovacuum / analyze settings snapshots
-- ---------------------------------------------------------------------------

create table public.autovacuum_settings (
  id uuid primary key default gen_random_uuid(),
  database_id uuid not null references public.monitored_databases (id) on delete cascade,
  captured_at timestamptz not null default now(),
  scope public.autovacuum_scope not null,
  schema_name text,
  table_name text,
  settings jsonb not null,
  -- e.g. autovacuum_vacuum_scale_factor, autovacuum_vacuum_threshold, ...
  unique (database_id, captured_at, scope, schema_name, table_name)
);

create index autovacuum_settings_database_captured_idx
  on public.autovacuum_settings (database_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger monitored_databases_updated_at
  before update on public.monitored_databases
  for each row execute function public.set_updated_at();

create trigger database_preferences_updated_at
  before update on public.database_preferences
  for each row execute function public.set_updated_at();

create trigger maintenance_schedules_updated_at
  before update on public.maintenance_schedules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.monitored_databases enable row level security;
alter table public.database_preferences enable row level security;
alter table public.maintenance_schedules enable row level security;
alter table public.database_metrics enable row level security;
alter table public.bloat_objects enable row level security;
alter table public.maintenance_jobs enable row level security;
alter table public.maintenance_operations enable row level security;
alter table public.autovacuum_settings enable row level security;

-- Users own their monitored databases; child rows inherit via database_id

create policy "Users manage own monitored databases"
  on public.monitored_databases
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage preferences for own databases"
  on public.database_preferences
  for all
  using (
    exists (
      select 1 from public.monitored_databases d
      where d.id = database_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.monitored_databases d
      where d.id = database_id and d.user_id = auth.uid()
    )
  );

create policy "Users manage schedules for own databases"
  on public.maintenance_schedules
  for all
  using (
    exists (
      select 1 from public.monitored_databases d
      where d.id = database_id and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.monitored_databases d
      where d.id = database_id and d.user_id = auth.uid()
    )
  );

create policy "Users read metrics for own databases"
  on public.database_metrics
  for select
  using (
    exists (
      select 1 from public.monitored_databases d
      where d.id = database_id and d.user_id = auth.uid()
    )
  );

create policy "Users read bloat for own databases"
  on public.bloat_objects
  for select
  using (
    exists (
      select 1 from public.monitored_databases d
      where d.id = database_id and d.user_id = auth.uid()
    )
  );

create policy "Users read jobs for own databases"
  on public.maintenance_jobs
  for select
  using (
    exists (
      select 1 from public.monitored_databases d
      where d.id = database_id and d.user_id = auth.uid()
    )
  );

create policy "Users read operations for own jobs"
  on public.maintenance_operations
  for select
  using (
    exists (
      select 1
      from public.maintenance_jobs j
      join public.monitored_databases d on d.id = j.database_id
      where j.id = job_id and d.user_id = auth.uid()
    )
  );

create policy "Users read autovacuum settings for own databases"
  on public.autovacuum_settings
  for select
  using (
    exists (
      select 1 from public.monitored_databases d
      where d.id = database_id and d.user_id = auth.uid()
    )
  );

-- Service role bypasses RLS for worker writes (metrics, jobs, operations)
