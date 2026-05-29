-- Store or replace the postgres (or other privileged) connection used for VACUUM/REINDEX.

create or replace function public.save_database_maintenance_connection(
  p_database_id uuid,
  p_connection_string text
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_old_maint uuid;
  v_conn uuid;
  v_secret_id uuid;
  v_secret_name text;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_connection_string is null or length(trim(p_connection_string)) = 0 then
    raise exception 'connection_string is required' using errcode = '22023';
  end if;

  select maintenance_connection_vault_id::uuid, connection_vault_id::uuid
  into v_old_maint, v_conn
  from public.monitored_databases
  where id = p_database_id and user_id = v_user_id;

  if not found then
    raise exception 'database not found' using errcode = 'P0002';
  end if;

  v_secret_name :=
    'vs_maint_' || replace(v_user_id::text, '-', '') || '_' || gen_random_uuid()::text;

  select vault.create_secret(
    trim(p_connection_string),
    v_secret_name,
    'VacuumShift maintenance connection'
  ) into v_secret_id;

  update public.monitored_databases
  set maintenance_connection_vault_id = v_secret_id::text
  where id = p_database_id;

  if v_old_maint is not null and v_old_maint <> v_conn and v_old_maint <> v_secret_id then
    delete from vault.secrets where id = v_old_maint;
  end if;
end;
$$;

revoke all on function public.save_database_maintenance_connection(uuid, text) from public;
grant execute on function public.save_database_maintenance_connection(uuid, text) to authenticated;
