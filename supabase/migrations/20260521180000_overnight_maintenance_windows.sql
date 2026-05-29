-- Overnight maintenance windows: allow end <= start, normalize legacy 24:00 ends to midnight.

alter table public.user_default_schedules
  drop constraint if exists user_default_schedules_window_order;

update public.user_default_schedules
set window_end_time = '00:00:00'::time
where window_end_time >= '23:59:00'::time;

update public.maintenance_schedules
set window_end_time = '00:00:00'::time
where window_end_time is not null
  and window_end_time >= '23:59:00'::time;

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

  if p_window_end_time <= p_window_start_time then
    v_duration := (
      extract(
        epoch from (p_window_end_time + interval '1 day' - p_window_start_time)
      ) / 60
    )::integer;
  else
    v_duration := (
      extract(epoch from (p_window_end_time - p_window_start_time)) / 60
    )::integer;
  end if;

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
