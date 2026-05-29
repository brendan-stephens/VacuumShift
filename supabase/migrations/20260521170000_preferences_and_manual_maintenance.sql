-- Extended preference fields on user defaults + save RPCs + manual maintenance queue.

alter table public.user_default_preferences
  add column if not exists min_index_size_mb integer not null default 0
    check (min_index_size_mb >= 0),
  add column if not exists pause_between_ops_ms integer not null default 0
    check (pause_between_ops_ms >= 0),
  add column if not exists exclude_patterns text[] not null default '{}';

create or replace function public.save_user_default_preferences(
  p_min_table_size_mb integer,
  p_min_index_size_mb integer,
  p_table_vacuum_mode public.table_vacuum_mode,
  p_index_reindex_mode public.index_reindex_mode,
  p_pause_between_ops_ms integer,
  p_exclude_patterns text[],
  p_enforce_time_window boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_min_table_size_mb is null or p_min_table_size_mb < 0 then
    raise exception 'min_table_size_mb must be >= 0' using errcode = '22023';
  end if;

  if p_min_index_size_mb is null or p_min_index_size_mb < 0 then
    raise exception 'min_index_size_mb must be >= 0' using errcode = '22023';
  end if;

  if p_pause_between_ops_ms is null or p_pause_between_ops_ms < 0 then
    raise exception 'pause_between_ops_ms must be >= 0' using errcode = '22023';
  end if;

  insert into public.user_default_preferences (
    user_id,
    min_table_size_mb,
    min_index_size_mb,
    table_vacuum_mode,
    index_reindex_mode,
    pause_between_ops_ms,
    exclude_patterns,
    enforce_time_window
  )
  values (
    v_user_id,
    p_min_table_size_mb,
    p_min_index_size_mb,
    p_table_vacuum_mode,
    p_index_reindex_mode,
    p_pause_between_ops_ms,
    coalesce(p_exclude_patterns, '{}'::text[]),
    p_enforce_time_window
  )
  on conflict (user_id) do update
  set
    min_table_size_mb = excluded.min_table_size_mb,
    min_index_size_mb = excluded.min_index_size_mb,
    table_vacuum_mode = excluded.table_vacuum_mode,
    index_reindex_mode = excluded.index_reindex_mode,
    pause_between_ops_ms = excluded.pause_between_ops_ms,
    exclude_patterns = excluded.exclude_patterns,
    enforce_time_window = excluded.enforce_time_window,
    updated_at = now();
end;
$$;

revoke all on function public.save_user_default_preferences(
  integer,
  integer,
  public.table_vacuum_mode,
  public.index_reindex_mode,
  integer,
  text[],
  boolean
) from public;

grant execute on function public.save_user_default_preferences(
  integer,
  integer,
  public.table_vacuum_mode,
  public.index_reindex_mode,
  integer,
  text[],
  boolean
) to authenticated;

create or replace function public.save_database_preferences(
  p_database_id uuid,
  p_min_table_size_mb integer,
  p_min_index_size_mb integer,
  p_table_vacuum_mode public.table_vacuum_mode,
  p_index_reindex_mode public.index_reindex_mode,
  p_pause_between_ops_ms integer,
  p_exclude_patterns text[],
  p_enforce_time_window boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_min_table_size_mb is null or p_min_table_size_mb < 0 then
    raise exception 'min_table_size_mb must be >= 0' using errcode = '22023';
  end if;

  if p_min_index_size_mb is null or p_min_index_size_mb < 0 then
    raise exception 'min_index_size_mb must be >= 0' using errcode = '22023';
  end if;

  if p_pause_between_ops_ms is null or p_pause_between_ops_ms < 0 then
    raise exception 'pause_between_ops_ms must be >= 0' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.monitored_databases
    where id = p_database_id and user_id = v_user_id
  ) then
    raise exception 'database not found' using errcode = 'P0002';
  end if;

  update public.database_preferences
  set
    min_table_size_mb = p_min_table_size_mb,
    min_index_size_mb = p_min_index_size_mb,
    table_vacuum_mode = p_table_vacuum_mode,
    index_reindex_mode = p_index_reindex_mode,
    pause_between_ops_ms = p_pause_between_ops_ms,
    exclude_patterns = coalesce(p_exclude_patterns, '{}'::text[]),
    enforce_time_window = p_enforce_time_window,
    updated_at = now()
  where database_id = p_database_id;

  if not found then
    raise exception 'database preferences not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.save_database_preferences(
  uuid,
  integer,
  integer,
  public.table_vacuum_mode,
  public.index_reindex_mode,
  integer,
  text[],
  boolean
) from public;

grant execute on function public.save_database_preferences(
  uuid,
  integer,
  integer,
  public.table_vacuum_mode,
  public.index_reindex_mode,
  integer,
  text[],
  boolean
) to authenticated;

create or replace function public.apply_user_defaults_to_database(p_database_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_prefs public.user_default_preferences%rowtype;
  v_schedules_applied integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.monitored_databases
    where id = p_database_id and user_id = v_user_id
  ) then
    raise exception 'database not found' using errcode = 'P0002';
  end if;

  select * into v_prefs
  from public.user_default_preferences
  where user_id = v_user_id;

  if found then
    update public.database_preferences
    set
      min_table_size_mb = v_prefs.min_table_size_mb,
      min_index_size_mb = v_prefs.min_index_size_mb,
      table_vacuum_mode = v_prefs.table_vacuum_mode,
      index_reindex_mode = v_prefs.index_reindex_mode,
      pause_between_ops_ms = v_prefs.pause_between_ops_ms,
      exclude_patterns = v_prefs.exclude_patterns,
      enforce_time_window = v_prefs.enforce_time_window,
      updated_at = now()
    where database_id = p_database_id;
  end if;

  delete from public.maintenance_schedules where database_id = p_database_id;
  v_schedules_applied := public.apply_user_default_schedules(p_database_id);

  return jsonb_build_object('schedules_applied', v_schedules_applied);
end;
$$;

create or replace function public.queue_manual_maintenance(p_database_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_job_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.monitored_databases
    where id = p_database_id and user_id = v_user_id
  ) then
    raise exception 'database not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.maintenance_jobs
    where database_id = p_database_id
      and kind = 'manual'
      and status in ('pending', 'running')
  ) then
    raise exception 'maintenance already queued or running' using errcode = '23505';
  end if;

  insert into public.maintenance_jobs (
    database_id, kind, status, window_started_at, window_ends_at
  ) values (
    p_database_id, 'manual', 'pending', now(), now() + interval '4 hours'
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function public.queue_manual_maintenance(uuid) from public;
grant execute on function public.queue_manual_maintenance(uuid) to authenticated;
