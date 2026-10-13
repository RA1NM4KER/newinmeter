-- Learn publication timing in shadow mode before increasing upstream work.
-- Unchanged records no longer acquire a new run id or refresh rollups. The
-- database owns the rolling budget so failures and concurrent workers count.
alter table public.livemopay_connections
  add column sync_schedule_mode text not null default 'shadow' check (sync_schedule_mode in ('shadow', 'adaptive')),
  add column reporting_model jsonb not null default '{}'::jsonb,
  add column last_reconciled_at timestamptz,
  add column auto_sync_failure_streak integer not null default 0,
  add column auto_sync_daily_budget integer not null default 24 check (auto_sync_daily_budget between 4 and 24);
alter table public.capture_runs
  add column rows_fetched integer,
  add column rows_changed integer,
  add column upstream_latest_at timestamptz,
  add column predicted_next_at timestamptz;
create index capture_runs_auto_budget_idx on public.capture_runs(connection_id, started_at) where trigger = 'auto';

create or replace function public.upsert_changed_energy_rows(p_connection_id uuid, p_run_id uuid, p_rows jsonb, p_force_refresh boolean default false)
returns integer language plpgsql set search_path = public as $$
declare v_changed integer;
begin
  if not exists (select 1 from capture_runs where id = p_run_id and connection_id = p_connection_id and status = 'running') then
    raise exception 'A running capture run for this connection is required';
  end if;
  insert into energy_rows as existing
    (connection_id,capture_dt,charge_label,period_dt,kwh,water_kl,tariff,cost,balance,source_ts,tariff_band,sync_run_id,last_seen_at)
  select p_connection_id,r.capture_dt,r.charge_label,r.period_dt,r.kwh,r.water_kl,r.tariff,r.cost,r.balance,r.source_ts,r.tariff_band,p_run_id,now()
  from jsonb_to_recordset(p_rows) as r(capture_dt text,charge_label text,period_dt text,kwh numeric,water_kl numeric,tariff numeric,cost numeric,balance numeric,source_ts timestamptz,tariff_band text)
  on conflict (connection_id,charge_label,period_dt,cost,balance) do update
  set capture_dt=excluded.capture_dt,kwh=excluded.kwh,water_kl=excluded.water_kl,tariff=excluded.tariff,
      source_ts=excluded.source_ts,tariff_band=excluded.tariff_band,sync_run_id=p_run_id,last_seen_at=now()
  where p_force_refresh
    or (existing.sync_run_id is distinct from p_run_id and exists (
      select 1 from capture_runs prior where prior.id=existing.sync_run_id and prior.status <> 'success'
    ))
    or (existing.capture_dt,existing.kwh,existing.water_kl,existing.tariff,existing.source_ts,existing.tariff_band)
    is distinct from (excluded.capture_dt,excluded.kwh,excluded.water_kl,excluded.tariff,excluded.source_ts,excluded.tariff_band);
  -- A lost HTTP response can be retried. Count the batch's rows already owned
  -- by this run as well, rather than reporting zero on an idempotent retry.
  select count(*) into v_changed from energy_rows e
  join jsonb_to_recordset(p_rows) as r(charge_label text,period_dt text,cost numeric,balance numeric)
    on e.charge_label=r.charge_label and e.period_dt=r.period_dt and e.cost=r.cost and e.balance=r.balance
  where e.connection_id=p_connection_id and e.sync_run_id=p_run_id;
  return v_changed;
end;
$$;
revoke all on function public.upsert_changed_energy_rows(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.upsert_changed_energy_rows(uuid,uuid,jsonb,boolean) to service_role;

-- NULL retains compatibility with the legacy ingestion path. New workers
-- explicitly report zero when neither ledger writes nor refund cleanup changed data.
drop trigger if exists capture_runs_refresh_rollups_update on public.capture_runs;
create trigger capture_runs_refresh_rollups_update after update on public.capture_runs for each row
when (new.status='success' and new.finished_at is not null
  and (old.status is distinct from new.status or old.finished_at is distinct from new.finished_at)
  and (new.rows_changed is null or new.rows_changed > 0))
execute function public.handle_newinmeter_capture_run_refresh();

create or replace function public.start_capture_run(p_run_id uuid,p_connection_id uuid,p_mode text,p_trigger text)
returns table (id uuid,status text) language plpgsql security definer set search_path = public as $$
declare v_connection public.livemopay_connections%rowtype;
begin
  select * into v_connection from livemopay_connections where livemopay_connections.id=p_connection_id for update;
  if not found then raise exception 'connection not found'; end if;
  if (p_trigger='restore' and v_connection.data_state <> 'restoring') or (p_trigger <> 'restore' and v_connection.data_state <> 'warm') then
    raise exception using errcode='55000',message='connection data is not available for this sync mode';
  end if;
  if p_trigger='auto' and (select count(*) from capture_runs where connection_id=p_connection_id and trigger='auto' and started_at>now()-interval '24 hours') >= v_connection.auto_sync_daily_budget then
    raise exception using errcode='P0001',message='Automatic sync daily budget reached';
  end if;
  return query insert into capture_runs(id,connection_id,mode,trigger,status)
    values(p_run_id,p_connection_id,p_mode,p_trigger,'running') returning capture_runs.id,capture_runs.status;
end;
$$;
revoke all on function public.start_capture_run(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.start_capture_run(uuid,uuid,text,text) to service_role;

create or replace function public.claim_due_auto_sync_connections(
  p_limit integer default 5,
  p_claim_ttl interval default interval '10 minutes'
)
returns table (
  id uuid,
  user_id uuid,
  account_id text,
  company_id text,
  property_id text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  refresh_token_auth_tag text
)
language sql
set search_path = public
as $$
  with budget_deferred as (
    update public.livemopay_connections c set next_sync_at = (
      select min(r.started_at)+interval '24 hours 1 minute' from public.capture_runs r
      where r.connection_id=c.id and r.trigger='auto' and r.started_at>now()-interval '24 hours'
    ) where c.next_sync_at <= now() and c.auto_sync_enabled
      and (select count(*) from public.capture_runs r where r.connection_id=c.id and r.trigger='auto' and r.started_at>now()-interval '24 hours') >= c.auto_sync_daily_budget
    returning c.id
  ), due as (
    select c.id
    from public.livemopay_connections c
    where c.status = 'connected'
      and c.data_state = 'warm'
      and c.is_demo = false
      and c.auto_sync_enabled = true
      and c.next_sync_at is not null
      and c.next_sync_at <= now()
      and c.account_id is not null
      and c.company_id is not null
      and c.property_id is not null
      and c.refresh_token_ciphertext is not null
      and (c.sync_claimed_at is null or c.sync_claimed_at < now() - p_claim_ttl)
      and not public.auto_sync_is_paused_for_inactivity(c.id)
      and (select count(*) from public.capture_runs r where r.connection_id=c.id and r.trigger='auto' and r.started_at>now()-interval '24 hours') < c.auto_sync_daily_budget
    order by c.next_sync_at
    limit greatest(least(p_limit, 25), 0)
    for update skip locked
  ),
  claimed as (
    update public.livemopay_connections c
    set sync_claimed_at = now()
    from due
    where c.id = due.id
    returning c.id, c.user_id, c.account_id, c.company_id, c.property_id,
              c.refresh_token_ciphertext, c.refresh_token_iv, c.refresh_token_auth_tag
  )
  select * from claimed;
$$;

revoke all on function public.claim_due_auto_sync_connections(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_due_auto_sync_connections(integer, interval) to service_role;


create or replace function public.trigger_newinmeter_auto_sync()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  -- Keep a ten-minute maintenance heartbeat below diagnostics' 15-minute
  -- warning threshold. Other ticks only wake the worker for eligible work.
  if extract(minute from now())::integer % 10 <> 0 and not exists (
    select 1 from livemopay_connections c
    where c.status='connected' and c.data_state='warm' and not c.is_demo
      and c.auto_sync_enabled and c.next_sync_at <= now()
      and c.account_id is not null and c.company_id is not null and c.property_id is not null
      and c.refresh_token_ciphertext is not null
      and (c.sync_claimed_at is null or c.sync_claimed_at < now()-interval '10 minutes')
      and not auto_sync_is_paused_for_inactivity(c.id)
      and (select count(*) from capture_runs r where r.connection_id=c.id and r.trigger='auto' and r.started_at>now()-interval '24 hours') < c.auto_sync_daily_budget
  ) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'newinmeter_auto_sync_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'newinmeter_auto_sync_secret';

  if v_url is null or v_secret is null then
    raise log 'newinmeter auto-sync: vault secrets not configured yet, skipping this tick';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    -- pg_net's implicit default is too short for the worker to legitimately
    -- finish a small batch of LiveMopay syncs (bounded concurrency, up to
    -- 10 claimed connections -- see /api/cron/auto-sync's own maxDuration =
    -- 60). 120s gives headroom above that without masking a genuinely hung
    -- request.
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.trigger_newinmeter_auto_sync() from public;

