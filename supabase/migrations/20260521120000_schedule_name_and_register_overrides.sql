-- Maintenance window display names + per-database overrides at registration.

alter table public.user_default_schedules
  add column if not exists name text not null default '';

alter table public.maintenance_schedules
  add column if not exists name text not null default '';

comment on column public.user_default_schedules.name is
  'User-facing label for this maintenance window (e.g. Weeknight maintenance).';
comment on column public.maintenance_schedules.name is
  'User-facing label copied from defaults or set per database.';

-- Insert one schedule row from interval/window fields (shared by apply + register).
create or replace function public._insert_maintenance_schedule(
  p_database_id uuid,
  p_name text,
  p_enabled boolean,
  p_interval_count integer,
  p_interval_unit public.schedule_interval_unit,
  p_days_of_week smallint[],
  p_day_of_month smallint,
  p_window_start_time time,
  p_window_end_time time,
  p_timezone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recurrence public.schedule_recurrence;
  v_duration integer;
  v_cron text;
  v_dow text;
begin
  if not coalesce(p_enabled, true) then
    return;
  end if;

  v_duration := (
    extract(epoch from (p_window_end_time - p_window_start_time)) / 60
  )::integer;
  if v_duration <= 0 then
    v_duration := 60;
  end if;

  v_recurrence := 'daily';
  v_cron := null;

  if p_interval_unit = 'day' and p_interval_count = 1 then
    v_recurrence := 'daily';
  elsif p_interval_unit = 'week'
    and p_interval_count = 1
    and cardinality(p_days_of_week) = 1
  then
    v_recurrence := 'weekly';
  elsif p_interval_unit = 'month'
    and p_interval_count = 1
    and p_day_of_month is not null
  then
    v_recurrence := 'monthly';
  else
    v_recurrence := 'bespoke';
    if p_interval_unit = 'day' then
      v_cron := format(
        '%s %s */%s * *',
        extract(minute from p_window_start_time)::int,
        extract(hour from p_window_start_time)::int,
        p_interval_count
      );
    elsif p_interval_unit = 'week' then
      select string_agg(d::text, ',' order by d)
      into v_dow
      from unnest(p_days_of_week) as d;
      v_cron := format(
        '%s %s * * %s',
        extract(minute from p_window_start_time)::int,
        extract(hour from p_window_start_time)::int,
        v_dow
      );
    else
      v_cron := format(
        '%s %s %s */%s *',
        extract(minute from p_window_start_time)::int,
        extract(hour from p_window_start_time)::int,
        coalesce(p_day_of_month, 1),
        p_interval_count
      );
    end if;
  end if;

  insert into public.maintenance_schedules (
    database_id,
    name,
    recurrence,
    enabled,
    timezone,
    window_start_time,
    window_end_time,
    window_duration_minutes,
    interval_count,
    interval_unit,
    days_of_week,
    day_of_week,
    day_of_month,
    cron_expression
  ) values (
    p_database_id,
    coalesce(nullif(trim(p_name), ''), ''),
    v_recurrence,
    true,
    p_timezone,
    p_window_start_time,
    p_window_end_time,
    v_duration,
    p_interval_count,
    p_interval_unit,
    coalesce(p_days_of_week, '{}'::smallint[]),
    case when cardinality(p_days_of_week) = 1 then p_days_of_week[1] else null end,
    p_day_of_month,
    v_cron
  );
end;
$$;

create or replace function public.apply_maintenance_schedules_json(
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
  v_item jsonb;
  v_unit public.schedule_interval_unit;
  v_dow smallint[];
  v_count integer := 0;
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

  if p_schedules is null or jsonb_typeof(p_schedules) <> 'array' then
    return 0;
  end if;

  for v_item in select value from jsonb_array_elements(p_schedules) as t(value) loop
    v_unit := (v_item->>'interval_unit')::public.schedule_interval_unit;

    select coalesce(array_agg(d::smallint order by d), '{}'::smallint[])
    into v_dow
    from jsonb_array_elements_text(coalesce(v_item->'days_of_week', '[]'::jsonb)) as e(d);

    if coalesce((v_item->>'enabled')::boolean, true) then
      perform public._insert_maintenance_schedule(
        p_database_id,
        v_item->>'name',
        true,
        greatest(coalesce((v_item->>'interval_count')::integer, 1), 1),
        v_unit,
        v_dow,
        (v_item->>'day_of_month')::smallint,
        coalesce((v_item->>'window_start_time')::time, '02:00'::time),
        coalesce((v_item->>'window_end_time')::time, '04:00'::time),
        coalesce(nullif(trim(v_item->>'timezone'), ''), 'UTC')
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.apply_maintenance_schedules_json(uuid, jsonb) from public;
grant execute on function public.apply_maintenance_schedules_json(uuid, jsonb) to authenticated;

create or replace function public.save_user_default_schedules(p_schedules jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_unit public.schedule_interval_unit;
  v_dow smallint[];
  v_i integer := 0;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_schedules is null then
    p_schedules := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_schedules) <> 'array' then
    raise exception 'p_schedules must be a json array' using errcode = '22023';
  end if;

  delete from public.user_default_schedules where user_id = v_user_id;

  for v_item in select value from jsonb_array_elements(p_schedules) as t(value) loop
    v_unit := (v_item->>'interval_unit')::public.schedule_interval_unit;

    select coalesce(array_agg(d::smallint order by d), '{}'::smallint[])
    into v_dow
    from jsonb_array_elements_text(coalesce(v_item->'days_of_week', '[]'::jsonb)) as e(d);

    insert into public.user_default_schedules (
      user_id,
      name,
      enabled,
      interval_count,
      interval_unit,
      days_of_week,
      day_of_month,
      window_start_time,
      window_end_time,
      timezone,
      sort_order
    ) values (
      v_user_id,
      coalesce(nullif(trim(v_item->>'name'), ''), ''),
      coalesce((v_item->>'enabled')::boolean, true),
      greatest(coalesce((v_item->>'interval_count')::integer, 1), 1),
      v_unit,
      v_dow,
      (v_item->>'day_of_month')::smallint,
      coalesce((v_item->>'window_start_time')::time, '02:00'::time),
      coalesce((v_item->>'window_end_time')::time, '04:00'::time),
      coalesce(nullif(trim(v_item->>'timezone'), ''), 'UTC'),
      v_i
    );
    v_i := v_i + 1;
  end loop;
end;
$$;

create or replace function public.apply_user_default_schedules(p_database_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row record;
  v_count integer := 0;
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

  for v_row in
    select *
    from public.user_default_schedules
    where user_id = v_user_id and enabled
    order by sort_order, created_at
  loop
    perform public._insert_maintenance_schedule(
      p_database_id,
      v_row.name,
      v_row.enabled,
      v_row.interval_count,
      v_row.interval_unit,
      v_row.days_of_week,
      v_row.day_of_month,
      v_row.window_start_time,
      v_row.window_end_time,
      v_row.timezone
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.register_monitored_database(
  p_label text,
  p_connection_string text,
  p_preferences jsonb default '{}'::jsonb,
  p_supabase_project_ref text default null,
  p_supabase_monitoring_role text default null,
  p_schedules jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_db_id uuid;
  v_secret_id uuid;
  v_secret_name text;
  v_initial_job_id uuid;
  v_run_initial boolean;
  v_exclude text[];
  v_schedules_applied integer;
  v_user_prefs public.user_default_preferences%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_label is null or length(trim(p_label)) = 0 then
    raise exception 'label is required' using errcode = '22023';
  end if;

  if p_connection_string is null or length(trim(p_connection_string)) = 0 then
    raise exception 'connection_string is required' using errcode = '22023';
  end if;

  if p_supabase_project_ref is not null and exists (
    select 1 from public.monitored_databases
    where user_id = v_user_id and supabase_project_ref = p_supabase_project_ref
  ) then
    raise exception 'project already monitored' using errcode = '23505';
  end if;

  select * into v_user_prefs
  from public.user_default_preferences
  where user_id = v_user_id;

  v_secret_name :=
    'vs_' || replace(v_user_id::text, '-', '') || '_' || gen_random_uuid()::text;

  select vault.create_secret(
    trim(p_connection_string),
    v_secret_name,
    'VacuumShift connection: ' || trim(p_label)
  ) into v_secret_id;

  insert into public.monitored_databases (
    user_id,
    label,
    connection_vault_id,
    supabase_project_ref,
    supabase_monitoring_role
  )
  values (
    v_user_id,
    trim(p_label),
    v_secret_id::text,
    p_supabase_project_ref,
    p_supabase_monitoring_role
  )
  returning id into v_db_id;

  v_run_initial := coalesce(
    (p_preferences->>'run_initial_check')::boolean,
    true
  );

  if p_preferences ? 'exclude_patterns' and jsonb_typeof(p_preferences->'exclude_patterns') = 'array' then
    select coalesce(array_agg(elem), '{}'::text[])
    into v_exclude
    from jsonb_array_elements_text(p_preferences->'exclude_patterns') as elem;
  else
    v_exclude := '{}'::text[];
  end if;

  insert into public.database_preferences (
    database_id,
    min_table_size_mb,
    min_index_size_mb,
    table_vacuum_mode,
    index_reindex_mode,
    pause_between_ops_ms,
    exclude_patterns,
    run_initial_check,
    enforce_time_window
  ) values (
    v_db_id,
    coalesce(
      (p_preferences->>'min_table_size_mb')::integer,
      v_user_prefs.min_table_size_mb,
      0
    ),
    coalesce((p_preferences->>'min_index_size_mb')::integer, 0),
    coalesce(
      (p_preferences->>'table_vacuum_mode')::public.table_vacuum_mode,
      v_user_prefs.table_vacuum_mode,
      'vacuum'::public.table_vacuum_mode
    ),
    coalesce(
      (p_preferences->>'index_reindex_mode')::public.index_reindex_mode,
      v_user_prefs.index_reindex_mode,
      'reindex'::public.index_reindex_mode
    ),
    coalesce((p_preferences->>'pause_between_ops_ms')::integer, 0),
    v_exclude,
    v_run_initial,
    coalesce(
      (p_preferences->>'enforce_time_window')::boolean,
      v_user_prefs.enforce_time_window,
      false
    )
  );

  if v_run_initial then
    insert into public.maintenance_jobs (
      database_id, kind, status, window_started_at, window_ends_at
    ) values (
      v_db_id, 'initial', 'pending', now(), now() + interval '1 hour'
    )
    returning id into v_initial_job_id;
  end if;

  if p_schedules is not null and jsonb_typeof(p_schedules) = 'array' and jsonb_array_length(p_schedules) > 0 then
    v_schedules_applied := public.apply_maintenance_schedules_json(v_db_id, p_schedules);
  else
    v_schedules_applied := public.apply_user_default_schedules(v_db_id);
  end if;

  return jsonb_build_object(
    'database_id', v_db_id,
    'connection_vault_id', v_secret_id::text,
    'initial_job_id', v_initial_job_id,
    'schedules_applied', v_schedules_applied
  );
exception
  when others then
    if v_secret_id is not null then
      delete from vault.secrets where id = v_secret_id;
    end if;
    raise;
end;
$$;

revoke all on function public.register_monitored_database(text, text, jsonb, text, text, jsonb) from public;
grant execute on function public.register_monitored_database(text, text, jsonb, text, text, jsonb) to authenticated;
