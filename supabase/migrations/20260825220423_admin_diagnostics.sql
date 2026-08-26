-- Admin Diagnostics / System Health.
--
-- This migration is additive. Existing sync rows, connection scheduling,
-- alerts, and push subscriptions are untouched. Operational tables follow
-- the same service-role-only posture as livemopay_connections and
-- push_subscriptions: RLS enabled, no browser policies, explicit revokes.

-- Future capture runs identify which application path started them. Existing
-- history stays honest as "unknown" instead of being incorrectly backfilled
-- as manual or automatic.
alter table public.capture_runs
  add column trigger text not null default 'unknown';

alter table public.capture_runs
  add constraint capture_runs_trigger_check
    check (trigger in ('unknown', 'manual', 'auto'));

create index capture_runs_connection_started_at_idx
  on public.capture_runs (connection_id, started_at desc);

-- Sparse operational event feed. Successful syncs remain in capture_runs;
-- this table is only for incidents and state transitions that do not belong
-- to one sync execution (canary, scheduler, push, repeated-failure episodes).
create table public.system_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  severity text not null,
  category text not null,
  event_type text not null,
  connection_id uuid references public.livemopay_connections(id) on delete set null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  incident_key text,
  resolved_at timestamptz,
  constraint system_events_severity_check check (severity in ('info', 'warning', 'critical')),
  constraint system_events_category_check
    check (category in ('sync', 'livemopay', 'scheduler', 'push', 'alerts', 'system')),
  constraint system_events_event_type_length check (char_length(event_type) between 1 and 100),
  constraint system_events_message_length check (char_length(message) between 1 and 500),
  constraint system_events_incident_key_length
    check (incident_key is null or char_length(incident_key) between 1 and 180),
  constraint system_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);

-- One unresolved row per logical incident is the durable push/event dedupe.
-- Once resolved, the same condition may create a fresh incident if it recurs.
create unique index system_events_one_open_incident_idx
  on public.system_events (incident_key)
  where incident_key is not null and resolved_at is null;

create index system_events_created_at_idx on public.system_events (created_at desc);
create index system_events_connection_created_at_idx
  on public.system_events (connection_id, created_at desc)
  where connection_id is not null;
create index system_events_unresolved_severity_idx
  on public.system_events (severity, created_at desc)
  where resolved_at is null;

alter table public.system_events enable row level security;
revoke all on public.system_events from anon, authenticated;
grant select, insert, update, delete on public.system_events to service_role;

-- Latest component heartbeat/check only. This is deliberately not a metrics
-- time series: scheduler ticks overwrite one row, so the 5-minute worker does
-- not create permanent telemetry noise.
create table public.system_health_state (
  component text primary key,
  status text not null,
  last_checked_at timestamptz not null,
  last_success_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint system_health_state_status_check check (status in ('healthy', 'warning', 'critical')),
  constraint system_health_state_component_length check (char_length(component) between 1 and 100),
  constraint system_health_state_details_object check (jsonb_typeof(details) = 'object')
);

alter table public.system_health_state enable row level security;
revoke all on public.system_health_state from anon, authenticated;
grant select, insert, update, delete on public.system_health_state to service_role;

-- Daily canary dispatch through the same pg_cron -> pg_net -> protected app
-- route pattern as auto-sync. It reuses the existing CRON_SECRET Vault entry
-- and needs only one new URL secret. Missing Vault configuration is a safe
-- no-op; Diagnostics will continue to show the canary as not configured.
create or replace function public.trigger_newinmeter_livemopay_canary()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'newinmeter_livemopay_canary_url';

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'newinmeter_auto_sync_secret';

  if v_url is null or v_secret is null then
    raise log 'newinmeter canary: vault URL/shared cron secret not configured, skipping daily check';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.trigger_newinmeter_livemopay_canary() from public;

-- 02:30 UTC = 04:30 Africa/Johannesburg. Once daily, away from the normal
-- 05:15 connection window, and never a high-frequency upstream probe.
select cron.schedule(
  'newinmeter-livemopay-canary',
  '30 2 * * *',
  $$select public.trigger_newinmeter_livemopay_canary();$$
);
