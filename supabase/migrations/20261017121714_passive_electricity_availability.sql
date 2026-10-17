-- Passive evidence from existing responses, isolated from the ledger and scheduler.
-- One compact row per capture, capped at 1024 per connection and retained 30 days.
-- No customer descriptions, quantities, prices, credentials or extra upstream calls.
create table public.electricity_fetch_observations (
  run_id uuid primary key references public.capture_runs(id) on delete cascade,
  connection_id uuid not null references public.livemopay_connections(id) on delete cascade,
  observed_at timestamptz not null,
  observation jsonb not null,
  constraint electricity_observation_bounded check (
    jsonb_typeof(observation) = 'object'
    and observation ?& array['version','items','fetchFinishedAt']
    and octet_length(observation::text) <= 65536
    and observation->>'version' = '1'
    and jsonb_typeof(observation->'items') = 'array'
    and jsonb_array_length(observation->'items') <= 256
  )
);
create index electricity_observations_connection_time_idx
  on public.electricity_fetch_observations(connection_id,observed_at desc,run_id);
create index electricity_observations_time_idx on public.electricity_fetch_observations(observed_at);
alter table public.electricity_fetch_observations enable row level security;
revoke all on public.electricity_fetch_observations from public,anon,authenticated;
grant select,insert,delete on public.electricity_fetch_observations to service_role;

-- Replacement for the existing metadata PATCH, not an extra request per success.
-- Diagnostics have their own exception boundary so storage failure cannot roll back
-- ingestion metadata or turn an electricity-empty successful sync into a failure.
create function public.record_capture_metadata(p_run_id uuid,p_metadata jsonb,p_observation jsonb default null)
returns boolean language plpgsql set search_path=public as $$
declare v_connection_id uuid;
begin
  select connection_id into v_connection_id from public.capture_runs where id=p_run_id;
  if not found then return false; end if;
  if p_metadata is not null then
    update public.capture_runs set
      rows_fetched=(p_metadata->>'rows_fetched')::integer,
      rows_changed=(p_metadata->>'rows_changed')::integer,
      upstream_latest_at=(p_metadata->>'upstream_latest_at')::timestamptz,
      predicted_next_at=(p_metadata->>'predicted_next_at')::timestamptz
    where id=p_run_id and status='running';
  end if;
  if p_observation is null then return null; end if;
  begin
    -- Keep the cap valid even if a failed-run recorder overlaps the next run.
    -- Never wait on telemetry contention or take the scheduler's row lock.
    if not pg_try_advisory_xact_lock(hashtextextended('electricity-observation:'||v_connection_id::text,0)) then
      return false;
    end if;
    -- The connection is derived from the capture, never trusted from JSON.
    insert into public.electricity_fetch_observations(run_id,connection_id,observed_at,observation)
      values(p_run_id,v_connection_id,(p_observation->>'fetchFinishedAt')::timestamptz,p_observation)
      on conflict(run_id) do nothing;
    delete from public.electricity_fetch_observations where run_id in (
      select run_id from public.electricity_fetch_observations
      where connection_id=v_connection_id order by observed_at desc,run_id offset 1024
    );
    -- Opportunistic TTL removes inactive connections too, without a new job.
    delete from public.electricity_fetch_observations where run_id in (
      select run_id from public.electricity_fetch_observations
      where observed_at<now()-interval '30 days' order by observed_at limit 128
    );
    return true;
  exception when others then
    raise log 'electricity_observation_write_failed sqlstate=%',sqlstate;
    return false;
  end;
end;
$$;
revoke all on function public.record_capture_metadata(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_capture_metadata(uuid,jsonb,jsonb) to service_role;

-- Reuse the existing daily maintenance invocation for TTL even if all users
-- stop fetching. No new cron and no changes to cold-storage lifecycle rules.
create function public.prune_electricity_observations()
returns integer language plpgsql set search_path=public as $$
declare v_deleted integer;
begin
  delete from public.electricity_fetch_observations where observed_at<now()-interval '30 days';
  get diagnostics v_deleted=row_count;
  return v_deleted;
end;
$$;
revoke all on function public.prune_electricity_observations() from public,anon,authenticated;
grant execute on function public.prune_electricity_observations() to service_role;
