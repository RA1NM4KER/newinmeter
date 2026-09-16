-- Make capture-run finalization idempotent and recover abandoned runs.
--
-- A 502/503/504 from PostgREST is an ambiguous outcome: the database may
-- have committed the update while the caller lost the response. A finalized
-- run must therefore never transition again (in particular success -> failed
-- from an error handler retry). Separately, a worker that dies after creating
-- a run must not retain the partial unique "one running run" lock forever.

create or replace function public.finish_capture_run(
  p_run_id uuid,
  p_status text,
  p_rows_synced integer default null,
  p_error text default null
)
returns void
language plpgsql
as $$
begin
  set local statement_timeout = '5min';

  update public.capture_runs
  set finished_at = now(),
      status = p_status,
      rows_synced = p_rows_synced,
      error = p_error
  where id = p_run_id
    and status = 'running';
end;
$$;

revoke execute on function public.finish_capture_run(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.finish_capture_run(uuid, text, integer, text) to service_role;

-- The hosted worker's maximum execution time is five minutes. Fifteen
-- minutes permits cold starts and a lost response while remaining a safe
-- upper bound for both automatic and manual runs. This function intentionally
-- only closes runs that have never been finalized; it never alters ledger
-- rows, so normal upsert/retry semantics stay intact.
create or replace function public.recover_stale_capture_runs(
  p_stale_after interval default interval '15 minutes'
)
returns table (id uuid, connection_id uuid)
language sql
as $$
  update public.capture_runs
  set status = 'failed',
      finished_at = now(),
      error = 'Sync worker did not finish before the recovery timeout.'
  where status = 'running'
    and started_at < now() - p_stale_after
  returning public.capture_runs.id, public.capture_runs.connection_id;
$$;

revoke all on function public.recover_stale_capture_runs(interval) from public, anon, authenticated;
grant execute on function public.recover_stale_capture_runs(interval) to service_role;
