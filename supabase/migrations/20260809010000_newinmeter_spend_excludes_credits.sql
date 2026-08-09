-- Daily spend should represent utility CONSUMPTION plus fixed fees only.
-- Credits -- top-ups, refunds and any other balance adjustment -- affect the
-- wallet balance but are not spend, so they must not move the spend trend.
--
-- Earlier (20260809000000) a refund was folded into total_spend as a negative,
-- which correctly reduced net spend but booked a whole multi-day overcharge
-- correction onto the single day LiveMopay issued it, producing a large
-- negative spike in the Daily spend chart. Revert that: total_spend counts only
-- energy, water and fixed charges (top-ups were already excluded). Refund stays
-- its own charge_kind, remains visible in the ledger, and still affects balance
-- (balance_end is taken from the latest row's balance, unchanged here).
--
-- Only total_spend changes; the rest of the function is identical to the
-- previous definition. All downstream spend figures (Daily spend chart, total
-- spend metric, month comparisons) read total_spend, so they inherit this.

create or replace function public.refresh_newinmeter_rollups_for_run(p_run_id uuid)
returns void
language plpgsql
as $$
declare
  run_record public.capture_runs%rowtype;
begin
  set local statement_timeout = '5min';

  select *
  into run_record
  from public.capture_runs
  where id = p_run_id;

  if not found then
    raise exception 'capture run % not found', p_run_id;
  end if;

  delete from public.energy_day_rollups
  where connection_id = run_record.connection_id
    and period_date in (
      select distinct public.parse_newinmeter_period_ts(period_dt)::date
      from public.energy_rows
      where sync_run_id = p_run_id
        and connection_id = run_record.connection_id
    );

  delete from public.energy_hourly_rollups
  where connection_id = run_record.connection_id
    and period_date in (
      select distinct public.parse_newinmeter_period_ts(period_dt)::date
      from public.energy_rows
      where sync_run_id = p_run_id
        and connection_id = run_record.connection_id
    );

  delete from public.energy_interval_rollups
  where connection_id = run_record.connection_id
    and period_date in (
      select distinct public.parse_newinmeter_period_ts(period_dt)::date
      from public.energy_rows
      where sync_run_id = p_run_id
        and connection_id = run_record.connection_id
    );

  with affected_dates as (
    select distinct public.parse_newinmeter_period_ts(period_dt)::date as period_date
    from public.energy_rows
    where sync_run_id = p_run_id
      and connection_id = run_record.connection_id
  ),
  daily_latest as (
    select distinct on (period_date)
      period_date,
      period_dt as latest_period,
      balance as balance_end
    from (
      select
        public.parse_newinmeter_period_ts(period_dt)::date as period_date,
        period_dt,
        balance,
        public.parse_newinmeter_period_ts(period_dt) as period_ts,
        public.parse_newinmeter_capture_ts(capture_dt) as capture_ts,
        id
      from public.energy_rows
      where connection_id = run_record.connection_id
        and public.parse_newinmeter_period_ts(period_dt)::date in (select period_date from affected_dates)
    ) ordered_rows
    order by period_date, period_ts desc, capture_ts desc, id desc
  ),
  daily_aggregates as (
    select
      public.parse_newinmeter_period_ts(period_dt)::date as period_date,
      round(sum(case when charge_kind = 'energy' then cost else 0 end)::numeric, 2) as energy_spend,
      round(sum(case when charge_kind = 'water' then cost else 0 end)::numeric, 2) as water_spend,
      round(sum(case when charge_kind = 'fixed' then cost else 0 end)::numeric, 2) as fixed_spend,
      round(sum(case when charge_kind = 'topup' then cost else 0 end)::numeric, 2) as topup_amount,
      round(sum(case when charge_kind in ('energy', 'water', 'fixed') then cost else 0 end)::numeric, 2) as total_spend,
      round(sum(case when charge_kind = 'energy' then kwh else 0 end)::numeric, 4) as energy_kwh,
      round(sum(case when charge_kind = 'water' then water_kl else 0 end)::numeric, 4) as water_kl,
      round(
        sum(case when charge_kind = 'energy' then (kwh * tariff) else 0 end)::numeric
        / nullif(sum(case when charge_kind = 'energy' then kwh else 0 end), 0),
        4
      ) as weighted_tariff,
      round(max(case when charge_kind = 'energy' then tariff else 0 end)::numeric, 4) as peak_tariff,
      round(
        sum(case when charge_kind in ('energy', 'fixed') then cost else 0 end)::numeric
        / nullif(sum(case when charge_kind = 'energy' then kwh else 0 end), 0),
        4
      ) as all_in_rate,
      count(distinct case when charge_kind = 'energy' then substring(period_dt from 12 for 5) end)::integer as energy_intervals,
      count(distinct case when charge_kind = 'water' then substring(period_dt from 12 for 5) end)::integer as water_intervals,
      count(distinct case when charge_kind = 'energy' then substring(period_dt from 12 for 5) end) >= 48 as is_complete
    from public.energy_rows
    where connection_id = run_record.connection_id
      and public.parse_newinmeter_period_ts(period_dt)::date in (select period_date from affected_dates)
    group by 1
  )
  insert into public.energy_day_rollups (
    connection_id,
    period_date,
    energy_spend,
    water_spend,
    fixed_spend,
    topup_amount,
    total_spend,
    energy_kwh,
    water_kl,
    weighted_tariff,
    peak_tariff,
    all_in_rate,
    balance_end,
    latest_period,
    energy_intervals,
    water_intervals,
    is_complete,
    updated_at,
    sync_run_id
  )
  select
    run_record.connection_id,
    daily_aggregates.period_date,
    coalesce(daily_aggregates.energy_spend, 0),
    coalesce(daily_aggregates.water_spend, 0),
    coalesce(daily_aggregates.fixed_spend, 0),
    coalesce(daily_aggregates.topup_amount, 0),
    coalesce(daily_aggregates.total_spend, 0),
    coalesce(daily_aggregates.energy_kwh, 0),
    coalesce(daily_aggregates.water_kl, 0),
    coalesce(daily_aggregates.weighted_tariff, 0),
    coalesce(daily_aggregates.peak_tariff, 0),
    coalesce(daily_aggregates.all_in_rate, 0),
    coalesce(daily_latest.balance_end, 0),
    daily_latest.latest_period,
    coalesce(daily_aggregates.energy_intervals, 0),
    coalesce(daily_aggregates.water_intervals, 0),
    coalesce(daily_aggregates.is_complete, false),
    now(),
    p_run_id
  from daily_aggregates
  left join daily_latest using (period_date)
  order by daily_aggregates.period_date;

  with affected_dates as (
    select distinct public.parse_newinmeter_period_ts(period_dt)::date as period_date
    from public.energy_rows
    where sync_run_id = p_run_id
      and connection_id = run_record.connection_id
  ),
  hourly_aggregates as (
    select
      public.parse_newinmeter_period_ts(period_dt)::date as period_date,
      extract(hour from public.parse_newinmeter_period_ts(period_dt))::smallint as hour,
      round(sum(case when charge_kind = 'energy' then cost else 0 end)::numeric, 2) as spend,
      round(sum(case when charge_kind = 'energy' then kwh else 0 end)::numeric, 4) as kwh,
      round(sum(case when charge_kind = 'water' then cost else 0 end)::numeric, 2) as water_spend,
      round(sum(case when charge_kind = 'water' then water_kl else 0 end)::numeric, 4) as water_kl,
      count(case when charge_kind = 'energy' then 1 end)::integer as intervals,
      count(case when charge_kind = 'water' then 1 end)::integer as water_intervals
    from public.energy_rows
    where connection_id = run_record.connection_id
      and charge_kind in ('energy', 'water')
      and public.parse_newinmeter_period_ts(period_dt)::date in (select period_date from affected_dates)
    group by 1, 2
  )
  insert into public.energy_hourly_rollups (
    connection_id,
    period_date,
    hour,
    spend,
    kwh,
    water_spend,
    water_kl,
    intervals,
    water_intervals,
    updated_at,
    sync_run_id
  )
  select
    run_record.connection_id,
    period_date,
    hour,
    spend,
    kwh,
    water_spend,
    water_kl,
    intervals,
    water_intervals,
    now(),
    p_run_id
  from hourly_aggregates
  order by period_date, hour;

  with affected_dates as (
    select distinct public.parse_newinmeter_period_ts(period_dt)::date as period_date
    from public.energy_rows
    where sync_run_id = p_run_id
      and connection_id = run_record.connection_id
  ),
  interval_aggregates as (
    select
      public.parse_newinmeter_period_ts(period_dt)::date as period_date,
      public.parse_newinmeter_period_ts(period_dt)::time without time zone as period_time,
      round(sum(case when charge_kind = 'energy' then cost else 0 end)::numeric, 2) as spend,
      round(sum(case when charge_kind = 'energy' then kwh else 0 end)::numeric, 4) as kwh,
      round(sum(case when charge_kind = 'water' then cost else 0 end)::numeric, 2) as water_spend,
      round(sum(case when charge_kind = 'water' then water_kl else 0 end)::numeric, 4) as water_kl
    from public.energy_rows
    where connection_id = run_record.connection_id
      and charge_kind in ('energy', 'water')
      and public.parse_newinmeter_period_ts(period_dt)::date in (select period_date from affected_dates)
    group by 1, 2
  )
  insert into public.energy_interval_rollups (
    connection_id,
    period_date,
    period_time,
    spend,
    kwh,
    water_spend,
    water_kl,
    updated_at,
    sync_run_id
  )
  select
    run_record.connection_id,
    period_date,
    period_time,
    spend,
    kwh,
    water_spend,
    water_kl,
    now(),
    p_run_id
  from interval_aggregates
  order by period_date, period_time;

  insert into public.dashboard_summary (
    connection_id,
    date_start,
    date_end,
    latest_balance,
    latest_period,
    last_synced_at,
    rows_in_csv,
    rows_synced,
    max_interval_spend,
    max_interval_kwh,
    max_water_interval_spend,
    max_water_interval_kl,
    updated_at,
    sync_run_id
  )
  select
    run_record.connection_id,
    (select min(period_date) from public.energy_day_rollups where connection_id = run_record.connection_id),
    (select max(period_date) from public.energy_day_rollups where connection_id = run_record.connection_id),
    (
      select balance
      from public.energy_rows
      where connection_id = run_record.connection_id
      order by source_ts desc nulls last, public.parse_newinmeter_capture_ts(capture_dt) desc, public.parse_newinmeter_period_ts(period_dt) desc, id desc
      limit 1
    ),
    (
      select period_dt
      from public.energy_rows
      where connection_id = run_record.connection_id
      order by source_ts desc nulls last, public.parse_newinmeter_capture_ts(capture_dt) desc, public.parse_newinmeter_period_ts(period_dt) desc, id desc
      limit 1
    ),
    run_record.finished_at,
    run_record.rows_in_csv,
    run_record.rows_synced,
    coalesce((select max(spend) from public.energy_interval_rollups where connection_id = run_record.connection_id), 0),
    coalesce((select max(kwh) from public.energy_interval_rollups where connection_id = run_record.connection_id), 0),
    coalesce((select max(water_spend) from public.energy_interval_rollups where connection_id = run_record.connection_id), 0),
    coalesce((select max(water_kl) from public.energy_interval_rollups where connection_id = run_record.connection_id), 0),
    now(),
    p_run_id
  on conflict (connection_id) do update set
    date_start = excluded.date_start,
    date_end = excluded.date_end,
    latest_balance = excluded.latest_balance,
    latest_period = excluded.latest_period,
    last_synced_at = excluded.last_synced_at,
    rows_in_csv = excluded.rows_in_csv,
    rows_synced = excluded.rows_synced,
    max_interval_spend = excluded.max_interval_spend,
    max_interval_kwh = excluded.max_interval_kwh,
    max_water_interval_spend = excluded.max_water_interval_spend,
    max_water_interval_kl = excluded.max_water_interval_kl,
    updated_at = excluded.updated_at,
    sync_run_id = excluded.sync_run_id;
end;
$$;
