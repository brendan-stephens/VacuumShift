-- PG 15/16: VACUUM/REINDEX require owner/superuser; store optional postgres maintenance URI.
-- PG 17+: vacuumshift may use MAINTAIN/pg_maintain; maintenance vault still optional.

alter table public.monitored_databases
  add column if not exists maintenance_connection_vault_id text;

comment on column public.monitored_databases.maintenance_connection_vault_id is
  'Vault secret for VACUUM/REINDEX (typically postgres). Falls back to connection_vault_id when null.';

create or replace function public.register_monitored_database(
  p_label text,
  p_connection_string text,
  p_preferences jsonb default '{}'::jsonb,
  p_supabase_project_ref text default null,
  p_supabase_monitoring_role text default null,
  p_schedules jsonb default null,
  p_maintenance_connection_string text default null
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
  v_maint_secret_id uuid;
  v_secret_name text;
  v_maint_secret_name text;
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

  v_maint_secret_id := null;
  if p_maintenance_connection_string is not null
     and length(trim(p_maintenance_connection_string)) > 0 then
    v_maint_secret_name :=
      'vs_maint_' || replace(v_user_id::text, '-', '') || '_' || gen_random_uuid()::text;
    select vault.create_secret(
      trim(p_maintenance_connection_string),
      v_maint_secret_name,
      'VacuumShift maintenance: ' || trim(p_label)
    ) into v_maint_secret_id;
  end if;

  insert into public.monitored_databases (
    user_id,
    label,
    connection_vault_id,
    maintenance_connection_vault_id,
    supabase_project_ref,
    supabase_monitoring_role
  )
  values (
    v_user_id,
    trim(p_label),
    v_secret_id::text,
    case when v_maint_secret_id is not null then v_maint_secret_id::text else null end,
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
    'maintenance_connection_vault_id',
      case when v_maint_secret_id is not null then v_maint_secret_id::text else null end,
    'initial_job_id', v_initial_job_id,
    'schedules_applied', v_schedules_applied
  );
exception
  when others then
    if v_maint_secret_id is not null then
      delete from vault.secrets where id = v_maint_secret_id;
    end if;
    if v_secret_id is not null then
      delete from vault.secrets where id = v_secret_id;
    end if;
    raise;
end;
$$;

revoke all on function public.register_monitored_database(text, text, jsonb, text, text, jsonb, text) from public;
grant execute on function public.register_monitored_database(text, text, jsonb, text, text, jsonb, text) to authenticated;

create or replace function public.delete_monitored_database(p_database_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_vault_id uuid;
  v_maint_vault_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select connection_vault_id::uuid, maintenance_connection_vault_id::uuid
  into v_vault_id, v_maint_vault_id
  from public.monitored_databases
  where id = p_database_id and user_id = auth.uid();

  if not found then
    raise exception 'database not found' using errcode = 'P0002';
  end if;

  delete from public.monitored_databases where id = p_database_id;

  if v_maint_vault_id is not null and v_maint_vault_id <> v_vault_id then
    delete from vault.secrets where id = v_maint_vault_id;
  end if;

  if v_vault_id is not null then
    delete from vault.secrets where id = v_vault_id;
  end if;
end;
$$;
