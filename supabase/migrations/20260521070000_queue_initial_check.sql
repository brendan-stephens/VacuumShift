-- Queue an initial bloat check for a database the caller owns (RLS allows select only on jobs).

create or replace function public.queue_initial_check(p_database_id uuid)
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

  insert into public.maintenance_jobs (
    database_id, kind, status, window_started_at, window_ends_at
  ) values (
    p_database_id, 'initial', 'pending', now(), now() + interval '1 hour'
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all on function public.queue_initial_check(uuid) from public;
grant execute on function public.queue_initial_check(uuid) to authenticated;
