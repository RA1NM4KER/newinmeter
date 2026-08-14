alter table public.usage_activities
  add column if not exists color text;

update public.usage_activities
set color = (array[
  '#0f766e',
  '#2563eb',
  '#c2410c',
  '#7c3aed',
  '#db2777',
  '#65a30d'
])[1 + mod(abs(hashtext(id::text)::bigint), 6)::integer]
where color is null;

alter table public.usage_activities
  alter column color set default '#0f766e',
  alter column color set not null;

alter table public.usage_activities
  drop constraint if exists usage_activities_color_valid;

alter table public.usage_activities
  add constraint usage_activities_color_valid
  check (color ~ '^#[0-9a-f]{6}$');

-- The report's return type gains the persisted activity colour. PostgreSQL
-- requires the dependent summary function to be dropped before changing that
-- table-shaped return type.
drop function if exists public.usage_activity_report_summary(date, date, text[], text);
drop function if exists public.usage_activity_report(date, date, text[], text);

create function public.usage_activity_report(
  p_from date,
  p_to date,
  p_tags text[] default null,
  p_utility text default 'all'
)
returns table (
  id uuid,
  starts_at timestamp without time zone,
  ends_at timestamp without time zone,
  all_day boolean,
  tags text[],
  color text,
  note text,
  created_at timestamptz,
  updated_at timestamptz,
  duration_minutes integer,
  electricity_kwh numeric,
  average_kw numeric,
  electricity_spend numeric,
  water_kl numeric,
  water_spend numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    activity.id,
    activity.starts_at,
    activity.ends_at,
    activity.all_day,
    activity.tags,
    activity.color,
    activity.note,
    activity.created_at,
    activity.updated_at,
    extract(epoch from (activity.ends_at - activity.starts_at))::integer / 60 as duration_minutes,
    coalesce(sum(interval_row.kwh), 0)::numeric as electricity_kwh,
    (
      coalesce(sum(interval_row.kwh), 0)
      / nullif(extract(epoch from (activity.ends_at - activity.starts_at)) / 3600, 0)
    )::numeric as average_kw,
    coalesce(sum(interval_row.spend), 0)::numeric as electricity_spend,
    coalesce(sum(interval_row.water_kl), 0)::numeric as water_kl,
    coalesce(sum(interval_row.water_spend), 0)::numeric as water_spend
  from public.usage_activities activity
  left join public.energy_interval_rollups interval_row
    on interval_row.connection_id = activity.connection_id
   and interval_row.period_date + interval_row.period_time >= activity.starts_at
   and interval_row.period_date + interval_row.period_time < activity.ends_at
  where activity.connection_id = public.my_livemopay_connection_id()
    and activity.starts_at < (p_to + 1)::timestamp
    and activity.ends_at > p_from::timestamp
    and (p_tags is null or cardinality(p_tags) = 0 or activity.tags && p_tags)
  group by activity.id
  having p_utility = 'all'
    or (p_utility = 'electricity' and coalesce(sum(interval_row.kwh), 0) > 0)
    or (p_utility = 'water' and coalesce(sum(interval_row.water_kl), 0) > 0)
  order by activity.starts_at asc, activity.created_at asc;
$$;

create function public.usage_activity_report_summary(
  p_from date,
  p_to date,
  p_tags text[] default null,
  p_utility text default 'all'
)
returns table (
  activity_count integer,
  tagged_duration_minutes integer,
  electricity_kwh numeric,
  average_electricity_kwh_per_activity numeric,
  electricity_spend numeric,
  water_kl numeric,
  water_spend numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select *
    from public.usage_activities activity
    where activity.connection_id = public.my_livemopay_connection_id()
      and activity.starts_at < (p_to + 1)::timestamp
      and activity.ends_at > p_from::timestamp
      and (p_tags is null or cardinality(p_tags) = 0 or activity.tags && p_tags)
      and (
        p_utility = 'all'
        or exists (
          select 1
          from public.energy_interval_rollups utility_interval
          where utility_interval.connection_id = activity.connection_id
            and utility_interval.period_date + utility_interval.period_time >= activity.starts_at
            and utility_interval.period_date + utility_interval.period_time < activity.ends_at
            and (
              (p_utility = 'electricity' and utility_interval.kwh > 0)
              or (p_utility = 'water' and utility_interval.water_kl > 0)
            )
        )
      )
  ),
  distinct_slots as (
    select distinct generated.slot_start
    from filtered activity
    cross join lateral generate_series(
      activity.starts_at,
      activity.ends_at - interval '30 minutes',
      interval '30 minutes'
    ) as generated(slot_start)
  ),
  unique_usage as (
    select
      coalesce(sum(interval_row.kwh), 0)::numeric as electricity_kwh,
      coalesce(sum(interval_row.spend), 0)::numeric as electricity_spend,
      coalesce(sum(interval_row.water_kl), 0)::numeric as water_kl,
      coalesce(sum(interval_row.water_spend), 0)::numeric as water_spend
    from public.energy_interval_rollups interval_row
    join distinct_slots slot
      on interval_row.connection_id = public.my_livemopay_connection_id()
     and interval_row.period_date + interval_row.period_time = slot.slot_start
  ),
  occurrence_usage as (
    select coalesce(sum(report.electricity_kwh), 0)::numeric as total_kwh
    from public.usage_activity_report(p_from, p_to, p_tags, p_utility) report
  )
  select
    (select count(*)::integer from filtered),
    (select count(*)::integer * 30 from distinct_slots),
    unique_usage.electricity_kwh,
    occurrence_usage.total_kwh / nullif((select count(*) from filtered), 0),
    unique_usage.electricity_spend,
    unique_usage.water_kl,
    unique_usage.water_spend
  from unique_usage, occurrence_usage;
$$;

revoke all on function public.usage_activity_report(date, date, text[], text) from public;
revoke all on function public.usage_activity_report_summary(date, date, text[], text) from public;
grant execute on function public.usage_activity_report(date, date, text[], text) to authenticated;
grant execute on function public.usage_activity_report_summary(date, date, text[], text) to authenticated;
