-- Inactive-user cold storage.
--
-- Only reproducible detail is removed: energy_rows, hourly rollups and
-- interval rollups. Auth, the connection and encrypted refresh token, daily
-- rollups/dashboard summary, usage activities, alerts, preferences and live
-- meter data are deliberately outside every DELETE below.

alter table public.livemopay_connections
  add column data_state text not null default 'warm',
  add column cold_at timestamptz,
  add column hibernation_started_at timestamptz,
  add column hibernation_claimed_at timestamptz,
  add column hibernation_error text,
  add column restore_started_at timestamptz,
  add column restore_error text,
  add column cold_energy_rows_deleted bigint not null default 0,
  add column cold_hourly_rollups_deleted bigint not null default 0,
  add column cold_interval_rollups_deleted bigint not null default 0;

alter table public.livemopay_connections
  add constraint livemopay_connections_data_state_check
    check (data_state in ('warm', 'hibernating', 'cold', 'restoring', 'restore_failed')),
  add constraint livemopay_connections_cold_delete_counts_check
    check (
      cold_energy_rows_deleted >= 0
      and cold_hourly_rollups_deleted >= 0
      and cold_interval_rollups_deleted >= 0
    );

comment on column public.livemopay_connections.data_state is
  'Lifecycle gate for detail data. Only warm connections participate in normal sync; hibernating is an internal purge lease.';
comment on column public.livemopay_connections.cold_at is
  'When reproducible detail was fully purged and the connection became cold.';

-- Small partial indexes for the two queue-like paths. The foreground table's
-- (user_id, activity_date) primary key supports the per-user max lookup.
create index livemopay_connections_hibernation_queue_idx
  on public.livemopay_connections (hibernation_claimed_at, connected_at)
  where data_state in ('warm', 'hibernating') and status = 'connected' and is_demo = false;

create index livemopay_connections_restore_queue_idx
  on public.livemopay_connections (restore_started_at)
  where data_state = 'restoring';

-- Existing capture runs only know manual/auto. Restoration is a distinct
-- operational trigger while keeping mode='restore' explicit too.
alter table public.capture_runs drop constraint capture_runs_trigger_check;
alter table public.capture_runs
  add constraint capture_runs_trigger_check
    check (trigger in ('unknown', 'manual', 'auto', 'restore'));

-- Normal auto-sync must never claim a non-warm connection. CREATE OR REPLACE
-- keeps the original signature/grants, followed by explicit least-privilege
-- revokes because functions receive PUBLIC execute by default.
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
  with due as (
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

-- Preview is intentionally service-role-only. It is useful for an operator to
-- inspect the exact candidate set before enabling the scheduled worker.
create or replace function public.list_cold_storage_candidates(
  p_inactive_for interval default interval '45 days',
  p_limit integer default 100
)
returns table (connection_id uuid, user_id uuid, last_product_activity_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select c.id, c.user_id,
    coalesce(
      activity.last_seen_at,
      greatest(u.last_sign_in_at, c.connected_at)
    ) as last_product_activity_at
  from public.livemopay_connections c
  join auth.users u on u.id = c.user_id
  left join lateral (
    select max(d.last_seen_at) as last_seen_at
    from public.user_activity_days d
    where d.user_id = c.user_id
  ) activity on true
  where c.status = 'connected'
    and c.data_state = 'warm'
    and c.is_demo = false
    and c.sync_claimed_at is null
    and c.account_id is not null
    and c.company_id is not null
    and c.property_id is not null
    and c.refresh_token_ciphertext is not null
    and coalesce(activity.last_seen_at, greatest(u.last_sign_in_at, c.connected_at)) <= now() - p_inactive_for
    and not exists (
      select 1 from public.user_roles r
      where r.user_id = c.user_id and (r.role = 'admin' or r.engagement_excluded)
    )
    and not c.alerts_enabled
    and not exists (
      select 1 from public.alert_rules ar
      where ar.connection_id = c.id and ar.enabled
    )
    and not exists (
      select 1 from public.meter_devices md
      where md.connection_id = c.id and md.enabled
    )
    and not exists (
      select 1 from public.capture_runs cr
      where cr.connection_id = c.id and cr.status = 'running'
    )
  order by last_product_activity_at, c.id
  limit greatest(least(p_limit, 500), 0);
$$;

revoke all on function public.list_cold_storage_candidates(interval, integer) from public, anon, authenticated;
grant execute on function public.list_cold_storage_candidates(interval, integer) to service_role;

-- Atomic queue claim. A stale hibernating row is resumable after a worker
-- crash; warm rows are rechecked against every exemption in the same locked
-- statement. Setting data_state='hibernating' is the sync gate.
create or replace function public.claim_cold_storage_candidates(
  p_limit integer default 1,
  p_inactive_for interval default interval '45 days',
  p_claim_ttl interval default interval '15 minutes'
)
returns table (connection_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if p_inactive_for < interval '45 days' then
    raise exception 'cold-storage inactivity threshold cannot be less than 45 days';
  end if;

  return query
  with eligible as (
    select c.id
    from public.livemopay_connections c
    join auth.users u on u.id = c.user_id
    left join lateral (
      select max(d.last_seen_at) as last_seen_at
      from public.user_activity_days d
      where d.user_id = c.user_id
    ) activity on true
    where (
      (
        c.data_state = 'warm'
        and c.status = 'connected'
        and c.is_demo = false
        and c.sync_claimed_at is null
        and c.account_id is not null
        and c.company_id is not null
        and c.property_id is not null
        and c.refresh_token_ciphertext is not null
        and coalesce(activity.last_seen_at, greatest(u.last_sign_in_at, c.connected_at)) <= now() - p_inactive_for
        and not exists (
          select 1 from public.user_roles r
          where r.user_id = c.user_id and (r.role = 'admin' or r.engagement_excluded)
        )
        and not c.alerts_enabled
        and not exists (
          select 1 from public.alert_rules ar
          where ar.connection_id = c.id and ar.enabled
        )
        and not exists (
          select 1 from public.meter_devices md
          where md.connection_id = c.id and md.enabled
        )
      )
      or (
        c.data_state = 'hibernating'
        and (
          c.hibernation_claimed_at is null
          or c.hibernation_claimed_at < now() - p_claim_ttl
        )
      )
    )
      and c.sync_claimed_at is null
      and not exists (
        select 1 from public.capture_runs cr
        where cr.connection_id = c.id and cr.status = 'running'
      )
    order by coalesce(activity.last_seen_at, greatest(u.last_sign_in_at, c.connected_at)), c.id
    limit greatest(least(p_limit, 10), 0)
    for update of c skip locked
  ),
  claimed as (
    update public.livemopay_connections c
    set data_state = 'hibernating',
        hibernation_started_at = coalesce(c.hibernation_started_at, now()),
        hibernation_claimed_at = now(),
        hibernation_error = null,
        updated_at = now()
    from eligible
    where c.id = eligible.id
    returning c.id, c.user_id
  )
  select claimed.id, claimed.user_id from claimed;
end;
$$;

revoke all on function public.claim_cold_storage_candidates(integer, interval, interval) from public, anon, authenticated;
grant execute on function public.claim_cold_storage_candidates(integer, interval, interval) to service_role;

-- Every call is one short, connection-scoped transaction. The worker loops
-- between calls, so it never holds a database lock while doing application or
-- LiveMopay work. ctid is only used inside each statement to bound a DELETE;
-- it is never persisted or returned.
create or replace function public.purge_cold_storage_batch(
  p_connection_id uuid,
  p_batch_size integer default 2000
)
returns table (energy_rows_deleted bigint, hourly_rollups_deleted bigint, interval_rollups_deleted bigint, remaining boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection public.livemopay_connections%rowtype;
  v_energy bigint := 0;
  v_hourly bigint := 0;
  v_interval bigint := 0;
  v_limit integer := greatest(least(p_batch_size, 5000), 1);
begin
  set local statement_timeout = '20s';
  set local lock_timeout = '2s';

  select * into v_connection
  from public.livemopay_connections
  where id = p_connection_id
  for update;

  if not found or v_connection.data_state <> 'hibernating' then
    raise exception 'connection is not claimed for hibernation';
  end if;
  if v_connection.sync_claimed_at is not null or exists (
    select 1 from public.capture_runs where connection_id = p_connection_id and status = 'running'
  ) then
    raise exception 'connection has active sync work';
  end if;

  with batch as (
    select ctid from public.energy_rows where connection_id = p_connection_id limit v_limit
  ), deleted as (
    delete from public.energy_rows e using batch where e.ctid = batch.ctid returning 1
  ) select count(*) into v_energy from deleted;

  with batch as (
    select ctid from public.energy_hourly_rollups where connection_id = p_connection_id limit v_limit
  ), deleted as (
    delete from public.energy_hourly_rollups e using batch where e.ctid = batch.ctid returning 1
  ) select count(*) into v_hourly from deleted;

  with batch as (
    select ctid from public.energy_interval_rollups where connection_id = p_connection_id limit v_limit
  ), deleted as (
    delete from public.energy_interval_rollups e using batch where e.ctid = batch.ctid returning 1
  ) select count(*) into v_interval from deleted;

  update public.livemopay_connections
  set cold_energy_rows_deleted = cold_energy_rows_deleted + v_energy,
      cold_hourly_rollups_deleted = cold_hourly_rollups_deleted + v_hourly,
      cold_interval_rollups_deleted = cold_interval_rollups_deleted + v_interval,
      hibernation_claimed_at = now(),
      updated_at = now()
  where id = p_connection_id;

  return query select v_energy, v_hourly, v_interval,
    exists (select 1 from public.energy_rows where connection_id = p_connection_id)
    or exists (select 1 from public.energy_hourly_rollups where connection_id = p_connection_id)
    or exists (select 1 from public.energy_interval_rollups where connection_id = p_connection_id);
end;
$$;

revoke all on function public.purge_cold_storage_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.purge_cold_storage_batch(uuid, integer) to service_role;

create or replace function public.complete_connection_hibernation(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.livemopay_connections where id = p_connection_id and data_state = 'hibernating' for update;
  if not found then raise exception 'connection is not hibernating'; end if;
  if exists (select 1 from public.capture_runs where connection_id = p_connection_id and status = 'running')
     or exists (select 1 from public.energy_rows where connection_id = p_connection_id)
     or exists (select 1 from public.energy_hourly_rollups where connection_id = p_connection_id)
     or exists (select 1 from public.energy_interval_rollups where connection_id = p_connection_id) then
    raise exception 'connection still has active work or reproducible detail';
  end if;

  update public.livemopay_connections
  set data_state = 'cold', cold_at = now(), hibernation_claimed_at = null,
      hibernation_error = null, sync_claimed_at = null, updated_at = now()
  where id = p_connection_id;
end;
$$;

create or replace function public.mark_connection_hibernation_error(p_connection_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.livemopay_connections
  set hibernation_error = left(p_error, 500), hibernation_claimed_at = null, updated_at = now()
  where id = p_connection_id and data_state = 'hibernating';
$$;

revoke all on function public.complete_connection_hibernation(uuid) from public, anon, authenticated;
revoke all on function public.mark_connection_hibernation_error(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_connection_hibernation(uuid) to service_role;
grant execute on function public.mark_connection_hibernation_error(uuid, text) to service_role;

-- The only authenticated lifecycle mutation. It can only move the caller's
-- own cold/failed connection toward restoration; it cannot purge anything or
-- read token material. Repeated calls while restoring return should_start=false.
create or replace function public.request_livemopay_restore()
returns table (connection_id uuid, data_state text, should_start boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connection public.livemopay_connections%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_connection
  from public.livemopay_connections c
  where c.user_id = auth.uid()
    and c.data_state in ('cold', 'restoring', 'restore_failed')
  order by c.connected_at desc
  limit 1
  for update;

  if not found then return; end if;
  if v_connection.data_state = 'restoring' then
    return query select v_connection.id, v_connection.data_state, false;
    return;
  end if;
  if v_connection.data_state not in ('cold', 'restore_failed') then
    return query select v_connection.id, v_connection.data_state, false;
    return;
  end if;
  if v_connection.status <> 'connected' or v_connection.refresh_token_ciphertext is null then
    return query select v_connection.id, v_connection.data_state, false;
    return;
  end if;

  update public.livemopay_connections
  set data_state = 'restoring', restore_started_at = now(), restore_error = null, updated_at = now()
  where id = v_connection.id;
  return query select v_connection.id, 'restoring'::text, true;
end;
$$;

revoke all on function public.request_livemopay_restore() from public, anon, service_role;
grant execute on function public.request_livemopay_restore() to authenticated;

create or replace function public.complete_connection_restore(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.livemopay_connections
  set data_state = 'warm', cold_at = null, restore_error = null,
      hibernation_started_at = null, hibernation_claimed_at = null,
      hibernation_error = null,
      next_sync_at = case when auto_sync_enabled then now() + interval '6 hours' else null end,
      updated_at = now()
  where id = p_connection_id and data_state = 'restoring';
  if not found then raise exception 'connection is not restoring'; end if;
end;
$$;

create or replace function public.fail_connection_restore(p_connection_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.livemopay_connections
  set data_state = 'restore_failed', restore_error = left(p_error, 500), updated_at = now()
  where id = p_connection_id and data_state = 'restoring';
$$;

create or replace function public.recover_stale_connection_restores(p_stale_after interval default interval '30 minutes')
returns table (connection_id uuid)
language sql
security definer
set search_path = public
as $$
  update public.livemopay_connections c
  set data_state = 'restore_failed', restore_error = 'Restoration worker stopped before completing. Please retry.', updated_at = now()
  where c.data_state = 'restoring'
    and c.restore_started_at < now() - p_stale_after
    and not exists (
      select 1 from public.capture_runs cr where cr.connection_id = c.id and cr.status = 'running'
    )
  returning c.id;
$$;

revoke all on function public.complete_connection_restore(uuid) from public, anon, authenticated;
revoke all on function public.fail_connection_restore(uuid, text) from public, anon, authenticated;
revoke all on function public.recover_stale_connection_restores(interval) from public, anon, authenticated;
grant execute on function public.complete_connection_restore(uuid) to service_role;
grant execute on function public.fail_connection_restore(uuid, text) to service_role;
grant execute on function public.recover_stale_connection_restores(interval) to service_role;

-- Starting a capture is now a short row-locked RPC. This closes the race where
-- a plain INSERT could begin after eligibility was checked but before the
-- hibernation state was committed. No HTTP call occurs inside this lock.
create or replace function public.start_capture_run(
  p_run_id uuid,
  p_connection_id uuid,
  p_mode text,
  p_trigger text
)
returns table (id uuid, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  select data_state into v_state
  from public.livemopay_connections
  where livemopay_connections.id = p_connection_id
  for update;
  if not found then raise exception 'connection not found'; end if;

  if (p_trigger = 'restore' and v_state <> 'restoring')
     or (p_trigger <> 'restore' and v_state <> 'warm') then
    raise exception using errcode = '55000', message = 'connection data is not available for this sync mode';
  end if;

  return query
  insert into public.capture_runs (id, connection_id, mode, trigger, status)
  values (p_run_id, p_connection_id, p_mode, p_trigger, 'running')
  returning capture_runs.id, capture_runs.status;
end;
$$;

revoke all on function public.start_capture_run(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_capture_run(uuid, uuid, text, text) to service_role;
