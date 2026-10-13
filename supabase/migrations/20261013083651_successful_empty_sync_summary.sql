-- Skipping rollup computation must not leave the dashboard's successful-check
-- timestamp frozen. Empty successful checks update only summary metadata.
create or replace function public.record_empty_sync_summary()
returns trigger language plpgsql set search_path=public as $$
begin
  update public.dashboard_summary
  set last_synced_at=new.finished_at,rows_in_csv=new.rows_in_csv,
      rows_synced=new.rows_synced,updated_at=now(),sync_run_id=new.id
  where connection_id=new.connection_id;
  return new;
end;
$$;
revoke all on function public.record_empty_sync_summary() from public,anon,authenticated;
grant execute on function public.record_empty_sync_summary() to service_role;
create trigger capture_runs_empty_sync_summary after update on public.capture_runs for each row
when (new.status='success' and new.finished_at is not null and new.rows_changed=0
  and (old.status is distinct from new.status or old.finished_at is distinct from new.finished_at))
execute function public.record_empty_sync_summary();
