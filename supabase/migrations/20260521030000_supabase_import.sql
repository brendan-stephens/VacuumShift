-- Link monitored DBs to Supabase projects; store Management API PAT per user.

alter table public.monitored_databases
  add column if not exists supabase_project_ref text;

create unique index if not exists monitored_databases_user_supabase_ref_idx
  on public.monitored_databases (user_id, supabase_project_ref)
  where supabase_project_ref is not null;

create table if not exists public.user_supabase_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  access_token_vault_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.user_supabase_accounts enable row level security;

create policy "Users read own supabase account link"
  on public.user_supabase_accounts
  for select
  using (auth.uid() = user_id);

create policy "Users delete own supabase account link"
  on public.user_supabase_accounts
  for delete
  using (auth.uid() = user_id);

-- Store PAT in Vault (never in plain tables)
create or replace function public.save_supabase_access_token(p_access_token text)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_secret_id uuid;
  v_secret_name text;
  v_old_vault_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_access_token is null or length(trim(p_access_token)) = 0 then
    raise exception 'access_token is required' using errcode = '22023';
  end if;

  select access_token_vault_id::uuid into v_old_vault_id
  from public.user_supabase_accounts
  where user_id = v_user_id;

  v_secret_name := 'vs_pat_' || replace(v_user_id::text, '-', '') || '_' || gen_random_uuid()::text;

  select vault.create_secret(
    trim(p_access_token),
    v_secret_name,
    'Supabase Management API token'
  ) into v_secret_id;

  insert into public.user_supabase_accounts (user_id, access_token_vault_id, updated_at)
  values (v_user_id, v_secret_id::text, now())
  on conflict (user_id) do update set
    access_token_vault_id = excluded.access_token_vault_id,
    updated_at = now();

  if v_old_vault_id is not null and v_old_vault_id <> v_secret_id then
    delete from vault.secrets where id = v_old_vault_id;
  end if;
end;
$$;

-- Edge Functions only: returns PAT to server runtime, not for browser exposure
create or replace function public.get_user_supabase_access_token()
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_secret text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select ds.decrypted_secret into v_secret
  from public.user_supabase_accounts a
  join vault.decrypted_secrets ds on ds.id = a.access_token_vault_id::uuid
  where a.user_id = v_user_id;

  if v_secret is null then
    raise exception 'no saved Supabase access token' using errcode = 'P0002';
  end if;

  return v_secret;
end;
$$;

create or replace function public.clear_supabase_access_token()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_vault_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select access_token_vault_id::uuid into v_vault_id
  from public.user_supabase_accounts
  where user_id = v_user_id;

  delete from public.user_supabase_accounts where user_id = v_user_id;

  if v_vault_id is not null then
    delete from vault.secrets where id = v_vault_id;
  end if;
end;
$$;

-- Extend register to optionally link Supabase project ref
create or replace function public.register_monitored_database(
  p_label text,
  p_connection_string text,
  p_preferences jsonb default '{}'::jsonb,
  p_supabase_project_ref text default null
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
    user_id, label, connection_vault_id, supabase_project_ref
  )
  values (v_user_id, trim(p_label), v_secret_id::text, p_supabase_project_ref)
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

revoke all on function public.save_supabase_access_token(text) from public;
grant execute on function public.save_supabase_access_token(text) to authenticated;

revoke all on function public.get_user_supabase_access_token() from public;
grant execute on function public.get_user_supabase_access_token() to authenticated;

revoke all on function public.clear_supabase_access_token() from public;
grant execute on function public.clear_supabase_access_token() to authenticated;

revoke all on function public.register_monitored_database(text, text, jsonb, text) from public;
grant execute on function public.register_monitored_database(text, text, jsonb, text) to authenticated;
