-- Per-user defaults applied when registering or importing monitored databases.

create table public.user_default_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  min_table_size_mb integer not null default 0 check (min_table_size_mb >= 0),
  table_vacuum_mode public.table_vacuum_mode not null default 'vacuum',
  index_reindex_mode public.index_reindex_mode not null default 'reindex',
  enforce_time_window boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger user_default_preferences_updated_at
  before update on public.user_default_preferences
  for each row execute function public.set_updated_at();

comment on table public.user_default_preferences is
  'Default maintenance preferences for newly added monitored databases.';

alter table public.user_default_preferences enable row level security;

create policy "Users manage own default preferences"
  on public.user_default_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
