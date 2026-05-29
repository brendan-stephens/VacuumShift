-- Track the Postgres role VacuumShift provisioned on Supabase imports (for optional cleanup).

alter table public.monitored_databases
  add column if not exists supabase_monitoring_role text;

create or replace function public.register_monitored_database(
  p_label text,
  p_connection_string text,
  p_preferences jsonb default '{}'::jsonb,
  p_supabase_project_ref text default null,
  p_supabase_monitoring_role text default null
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

  v_run_initial := coalesce((p_preferences->>'run_initial_check')::boolean, false);

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
    coalesce((p_preferences->>'min_table_size_mb')::integer, 0),
    coalesce((p_preferences->>'min_index_size_mb')::integer, 0),
    coalesce(
      (p_preferences->>'table_vacuum_mode')::public.table_vacuum_mode,
      'vacuum'::public.table_vacuum_mode
    ),
    coalesce(
      (p_preferences->>'index_reindex_mode')::public.index_reindex_mode,
      'reindex'::public.index_reindex_mode
    ),
    coalesce((p_preferences->>'pause_between_ops_ms')::integer, 0),
    v_exclude,
    v_run_initial,
    coalesce((p_preferences->>'enforce_time_window')::boolean, false)
  );

  if v_run_initial then
    insert into public.maintenance_jobs (
      database_id, kind, status, window_started_at, window_ends_at
    ) values (
      v_db_id, 'initial', 'pending', now(), now() + interval '1 hour'
    )
    returning id into v_initial_job_id;
  end if;

  return jsonb_build_object(
    'database_id', v_db_id,
    'connection_vault_id', v_secret_id::text,
    'initial_job_id', v_initial_job_id
  );
exception
  when others then
    if v_secret_id is not null then
      delete from vault.secrets where id = v_secret_id;
    end if;
    raise;
end;
$$;

revoke all on function public.register_monitored_database(text, text, jsonb, text, text) from public;
grant execute on function public.register_monitored_database(text, text, jsonb, text, text) to authenticated;
