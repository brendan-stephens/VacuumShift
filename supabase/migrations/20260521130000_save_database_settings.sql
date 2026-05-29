-- Per-database preferences and maintenance schedules (editable on database detail page).

create or replace function public.save_database_preferences(
  p_database_id uuid,
  p_min_table_size_mb integer,
  p_table_vacuum_mode public.table_vacuum_mode,
  p_index_reindex_mode public.index_reindex_mode,
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

  if not exists (
    select 1 from public.monitored_databases
    where id = p_database_id and user_id = v_user_id
  ) then
    raise exception 'database not found' using errcode = 'P0002';
  end if;

  update public.database_preferences
  set
    min_table_size_mb = p_min_table_size_mb,
    table_vacuum_mode = p_table_vacuum_mode,
    index_reindex_mode = p_index_reindex_mode,
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
  public.table_vacuum_mode,
  public.index_reindex_mode,
  boolean
) from public;

grant execute on function public.save_database_preferences(
  uuid,
  integer,
  public.table_vacuum_mode,
  public.index_reindex_mode,
  boolean
) to authenticated;

create or replace function public.save_database_schedules(
  p_database_id uuid,
  p_schedules jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
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

  if p_schedules is null then
    p_schedules := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_schedules) <> 'array' then
    raise exception 'p_schedules must be a json array' using errcode = '22023';
  end if;

  delete from public.maintenance_schedules where database_id = p_database_id;

  v_count := public.apply_maintenance_schedules_json(p_database_id, p_schedules);
  return v_count;
end;
$$;

revoke all on function public.save_database_schedules(uuid, jsonb) from public;
grant execute on function public.save_database_schedules(uuid, jsonb) to authenticated;

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
      table_vacuum_mode = v_prefs.table_vacuum_mode,
      index_reindex_mode = v_prefs.index_reindex_mode,
      enforce_time_window = v_prefs.enforce_time_window,
      updated_at = now()
    where database_id = p_database_id;
  end if;

  delete from public.maintenance_schedules where database_id = p_database_id;
  v_schedules_applied := public.apply_user_default_schedules(p_database_id);

  return jsonb_build_object('schedules_applied', v_schedules_applied);
end;
$$;

revoke all on function public.apply_user_defaults_to_database(uuid) from public;
grant execute on function public.apply_user_defaults_to_database(uuid) to authenticated;
