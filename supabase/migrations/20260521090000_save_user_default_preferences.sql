-- Save default preferences via RPC (reliable with RLS; works after schema reload).

create or replace function public.save_user_default_preferences(
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

  insert into public.user_default_preferences (
    user_id,
    min_table_size_mb,
    table_vacuum_mode,
    index_reindex_mode,
    enforce_time_window
  )
  values (
    v_user_id,
    p_min_table_size_mb,
    p_table_vacuum_mode,
    p_index_reindex_mode,
    p_enforce_time_window
  )
  on conflict (user_id) do update
  set
    min_table_size_mb = excluded.min_table_size_mb,
    table_vacuum_mode = excluded.table_vacuum_mode,
    index_reindex_mode = excluded.index_reindex_mode,
    enforce_time_window = excluded.enforce_time_window,
    updated_at = now();
end;
$$;

revoke all on function public.save_user_default_preferences(
  integer,
  public.table_vacuum_mode,
  public.index_reindex_mode,
  boolean
) from public;

grant execute on function public.save_user_default_preferences(
  integer,
  public.table_vacuum_mode,
  public.index_reindex_mode,
  boolean
) to authenticated;
