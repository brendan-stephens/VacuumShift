-- Delete a monitored database and its Vault connection secret (caller must own the row).

create or replace function public.delete_monitored_database(p_database_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_vault_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select connection_vault_id::uuid
  into v_vault_id
  from public.monitored_databases
  where id = p_database_id and user_id = auth.uid();

  if not found then
    raise exception 'database not found' using errcode = 'P0002';
  end if;

  delete from public.monitored_databases where id = p_database_id;

  if v_vault_id is not null then
    delete from vault.secrets where id = v_vault_id;
  end if;
end;
$$;

revoke all on function public.delete_monitored_database(uuid) from public;
grant execute on function public.delete_monitored_database(uuid) to authenticated;
