-- Default maintenance windows (applied to new monitored databases).

create type public.schedule_interval_unit as enum ('day', 'week', 'month');

create table public.user_default_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  interval_count integer not null default 1 check (interval_count >= 1),
  interval_unit public.schedule_interval_unit not null default 'week',
  -- 0=Sunday .. 6=Saturday; required when interval_unit = week
  days_of_week smallint[] not null default '{}',
  -- 1-28 when interval_unit = month
  day_of_month smallint check (day_of_month between 1 and 28),
  window_start_time time not null default '02:00',
  window_end_time time not null default '04:00',
  timezone text not null default 'UTC',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_default_schedules_dow_valid check (
    days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
  ),
  constraint user_default_schedules_weekly_days check (
    interval_unit <> 'week' or cardinality(days_of_week) >= 1
  ),
  constraint user_default_schedules_monthly_day check (
    interval_unit <> 'month' or day_of_month is not null
  ),
  constraint user_default_schedules_window_order check (
    window_end_time > window_start_time
  )
);

create index user_default_schedules_user_id_idx on public.user_default_schedules (user_id);

create trigger user_default_schedules_updated_at
  before update on public.user_default_schedules
  for each row execute function public.set_updated_at();

alter table public.user_default_schedules enable row level security;

create policy "Users manage own default schedules"
  on public.user_default_schedules
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Extend per-database schedules for interval / multi-day / end time
alter table public.maintenance_schedules
  add column if not exists interval_count integer not null default 1,
  add column if not exists interval_unit public.schedule_interval_unit,
  add column if not exists days_of_week smallint[] not null default '{}',
  add column if not exists window_end_time time;

alter table public.maintenance_schedules
  drop constraint if exists schedule_recurrence_fields;

alter table public.maintenance_schedules
  add constraint schedule_recurrence_fields check (
    (recurrence = 'bespoke' and cron_expression is not null)
    or (recurrence in ('daily', 'weekly', 'monthly'))
  );

-- Replace all default schedules for the current user (jsonb array).
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

revoke all on function public.save_user_default_schedules(jsonb) from public;
grant execute on function public.save_user_default_schedules(jsonb) to authenticated;

-- Copy user default schedules onto a monitored database.
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
  v_recurrence public.schedule_recurrence;
  v_duration integer;
  v_cron text;
  v_dow text;
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
    v_duration := (
      extract(epoch from (v_row.window_end_time - v_row.window_start_time)) / 60
    )::integer;
    if v_duration <= 0 then
      v_duration := 60;
    end if;

    v_recurrence := 'daily';
    v_cron := null;

    if v_row.interval_unit = 'day' and v_row.interval_count = 1 then
      v_recurrence := 'daily';
    elsif v_row.interval_unit = 'week'
      and v_row.interval_count = 1
      and cardinality(v_row.days_of_week) = 1
    then
      v_recurrence := 'weekly';
    elsif v_row.interval_unit = 'month'
      and v_row.interval_count = 1
      and v_row.day_of_month is not null
    then
      v_recurrence := 'monthly';
    else
      v_recurrence := 'bespoke';
      if v_row.interval_unit = 'day' then
        v_cron := format(
          '%s %s */%s * *',
          extract(minute from v_row.window_start_time)::int,
          extract(hour from v_row.window_start_time)::int,
          v_row.interval_count
        );
      elsif v_row.interval_unit = 'week' then
        select string_agg(d::text, ',' order by d)
        into v_dow
        from unnest(v_row.days_of_week) as d;
        v_cron := format(
          '%s %s * * %s',
          extract(minute from v_row.window_start_time)::int,
          extract(hour from v_row.window_start_time)::int,
          v_dow
        );
      else
        v_cron := format(
          '%s %s %s */%s *',
          extract(minute from v_row.window_start_time)::int,
          extract(hour from v_row.window_start_time)::int,
          coalesce(v_row.day_of_month, 1),
          v_row.interval_count
        );
      end if;
    end if;

    insert into public.maintenance_schedules (
      database_id,
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
      v_recurrence,
      true,
      v_row.timezone,
      v_row.window_start_time,
      v_row.window_end_time,
      v_duration,
      v_row.interval_count,
      v_row.interval_unit,
      v_row.days_of_week,
      case when cardinality(v_row.days_of_week) = 1 then v_row.days_of_week[1] else null end,
      v_row.day_of_month,
      v_cron
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.apply_user_default_schedules(uuid) from public;
grant execute on function public.apply_user_default_schedules(uuid) to authenticated;
