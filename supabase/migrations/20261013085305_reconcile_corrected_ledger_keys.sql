-- A live reconciliation exposed historical one-cent balance corrections.
-- Preserve superseded entries privately before replacing confidently matched
-- ledger events, otherwise the old balance-based key double-counts usage.
create table public.ledger_reconciliation_audit (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.livemopay_connections(id) on delete cascade,
  run_id uuid not null references public.capture_runs(id) on delete cascade,
  old_row jsonb not null,
  archived_at timestamptz not null default now()
);
create index ledger_reconciliation_audit_connection_idx on public.ledger_reconciliation_audit(connection_id);
create index ledger_reconciliation_audit_run_idx on public.ledger_reconciliation_audit(run_id);
alter table public.ledger_reconciliation_audit enable row level security;
revoke all on public.ledger_reconciliation_audit from anon,authenticated;
grant select,insert on public.ledger_reconciliation_audit to service_role;
grant usage,select on sequence public.ledger_reconciliation_audit_id_seq to service_role;

create or replace function public.upsert_changed_energy_rows(p_connection_id uuid, p_run_id uuid, p_rows jsonb, p_force_refresh boolean default false)
returns integer language plpgsql set search_path = public as $$
declare v_changed integer; v_removed integer;
begin
  if not exists (select 1 from capture_runs where id = p_run_id and connection_id = p_connection_id and status = 'running') then
    raise exception 'A running capture run for this connection is required';
  end if;
  -- Balance/cost are part of the historical unique key. Correcting either
  -- must replace an identifiable prior event, not create double consumption.
  -- Archived rows make this reconciliation inspectable and reversible.
  with incoming as (
    select * from jsonb_to_recordset(p_rows) as r(capture_dt text,charge_label text,period_dt text,kwh numeric,water_kl numeric,tariff numeric,cost numeric,balance numeric,source_ts timestamptz,reconcile_key boolean)
  ), superseded as (
    select distinct old.id from energy_rows old join incoming r
      on old.connection_id=p_connection_id and old.charge_label=r.charge_label and old.period_dt=r.period_dt
    where r.reconcile_key is true and r.source_ts is not null
      and (old.cost,old.balance) is distinct from (r.cost,r.balance)
      and (
        old.source_ts=r.source_ts
        or (old.source_ts is null and old.capture_dt=r.capture_dt
          and (r.charge_label like 'Energy Charge:%' or r.charge_label like 'Water:%')
          and old.kwh=r.kwh and old.water_kl=r.water_kl and old.tariff=r.tariff
          and abs(old.cost-r.cost)<=0.01 and abs(old.balance-r.balance)<=0.01)
      )
      and not exists(select 1 from incoming keep where keep.charge_label=old.charge_label and keep.period_dt=old.period_dt and keep.cost=old.cost and keep.balance=old.balance)
  ), archived as (
    insert into ledger_reconciliation_audit(connection_id,run_id,old_row)
    select p_connection_id,p_run_id,to_jsonb(old) from energy_rows old join superseded s on s.id=old.id
    returning (old_row->>'id')::bigint as old_id
  )
  delete from energy_rows where id in (select old_id from archived);
  get diagnostics v_removed = row_count;
  insert into energy_rows as existing
    (connection_id,capture_dt,charge_label,period_dt,kwh,water_kl,tariff,cost,balance,source_ts,tariff_band,sync_run_id,last_seen_at)
  select p_connection_id,r.capture_dt,r.charge_label,r.period_dt,r.kwh,r.water_kl,r.tariff,r.cost,r.balance,r.source_ts,r.tariff_band,p_run_id,now()
  from jsonb_to_recordset(p_rows) as r(capture_dt text,charge_label text,period_dt text,kwh numeric,water_kl numeric,tariff numeric,cost numeric,balance numeric,source_ts timestamptz,tariff_band text)
  on conflict (connection_id,charge_label,period_dt,cost,balance) do update
  set capture_dt=excluded.capture_dt,kwh=excluded.kwh,water_kl=excluded.water_kl,tariff=excluded.tariff,
      source_ts=excluded.source_ts,tariff_band=excluded.tariff_band,sync_run_id=p_run_id,last_seen_at=now()
  where p_force_refresh or v_removed > 0
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

