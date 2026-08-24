-- First real alert system, built on top of automatic sync
-- (20260824000000_newinmeter_auto_sync_schedule.sql). Two small tables, no
-- one-column-per-alert-type sprawl on livemopay_connections:
--
--   alert_rules   -- what the user wants to be notified about, and at what
--                     threshold (one row per connection per type)
--   alert_events  -- persistent trigger/dedup state, so a condition that
--                     stays true across many syncs sends exactly one
--                     notification until it resolves
--
-- Ownership follows the connection_id convention already established by
-- usage_activities (20260804000000): RLS via my_livemopay_connection_id(),
-- not user_id directly, and not a service-role-only table like
-- livemopay_connections itself -- alert_rules is meant to be read/written by
-- the browser through normal RLS-scoped requests.

create table public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.livemopay_connections(id) on delete cascade,
  type text not null check (type in ('low_balance', 'daily_spend', 'daily_kwh', 'data_delayed')),
  enabled boolean not null default false,
  -- Nullable: data_delayed has no user-configurable threshold (it's a fixed
  -- system rule -- see evaluateDataDelayedAlerts). The other three require
  -- a positive threshold within a generous but real upper bound, rejecting
  -- obvious nonsense (e.g. a "R0.01 daily spend" alert that would fire
  -- every single day) without constraining legitimate use. Mirrored
  -- server-side in src/lib/newinmeter/alerts.ts -- this constraint is
  -- defense in depth, not the only validation.
  threshold numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alert_rules_threshold_by_type check (
    (type = 'data_delayed' and threshold is null)
    or (type = 'low_balance' and threshold > 0 and threshold <= 1000000)
    or (type = 'daily_spend' and threshold > 0 and threshold <= 1000000)
    or (type = 'daily_kwh' and threshold > 0 and threshold <= 10000)
  ),
  -- One rule per type per connection -- the app upserts on this, never
  -- accumulates duplicate rows for the same alert type.
  constraint alert_rules_one_per_connection_type unique (connection_id, type)
);

create index alert_rules_connection_id_idx on public.alert_rules (connection_id);

create or replace function public.set_alert_rules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger alert_rules_set_updated_at
before update on public.alert_rules
for each row execute function public.set_alert_rules_updated_at();

alter table public.alert_rules enable row level security;

-- Same shape as usage_activities: full CRUD for the owning connection,
-- nothing for anyone else. Ownership is derived server-side from auth.uid()
-- via my_livemopay_connection_id() -- a browser can never write a
-- connection_id it doesn't own, regardless of what a request body claims.
create policy "alert rules are readable by owner"
  on public.alert_rules for select to authenticated
  using (connection_id = public.my_livemopay_connection_id());

create policy "alert rules are insertable by owner"
  on public.alert_rules for insert to authenticated
  with check (connection_id = public.my_livemopay_connection_id());

create policy "alert rules are updatable by owner"
  on public.alert_rules for update to authenticated
  using (connection_id = public.my_livemopay_connection_id())
  with check (connection_id = public.my_livemopay_connection_id());

create policy "alert rules are deletable by owner"
  on public.alert_rules for delete to authenticated
  using (connection_id = public.my_livemopay_connection_id());

revoke all on public.alert_rules from anon;
grant select, insert, update, delete on public.alert_rules to authenticated;

-- ---------------------------------------------------------------------------
-- Alert events: persistent trigger/dedup state
-- ---------------------------------------------------------------------------
--
-- One "active" (resolved_at is null) event per rule is the dedup key for
-- low_balance and data_delayed -- a condition that stays true across many
-- syncs/ticks only ever has one active event, so only the first crossing
-- sends a notification. It resolves (resolved_at set) once the underlying
-- condition clears, and a later re-crossing creates a new event/notification.
--
-- daily_spend and daily_kwh are date-scoped instead: period_date is the
-- dedup key (one event per rule per SAST calendar day -- see
-- currentLocalDateString in schedule.ts). They don't need resolved_at
-- managed explicitly; the day boundary itself is what lets tomorrow trigger
-- independently, so it's simply left null for these two types.
create table public.alert_events (
  id uuid primary key default gen_random_uuid(),
  alert_rule_id uuid not null references public.alert_rules(id) on delete cascade,
  -- Denormalized (same pattern as capture_runs/energy_rows carrying
  -- connection_id directly) so RLS and the evaluator's own queries don't
  -- need to join through alert_rules.
  connection_id uuid not null references public.livemopay_connections(id) on delete cascade,
  -- Null for low_balance/data_delayed (not date-scoped); the SAST day this
  -- event belongs to for daily_spend/daily_kwh.
  period_date date,
  triggered_at timestamptz not null default now(),
  -- Generic numeric, meaning depends on alert_rules.type: currency for
  -- low_balance/daily_spend, kWh for daily_kwh, hours-since-last-sync for
  -- data_delayed. Documented here rather than split into separate typed
  -- columns, matching the "small extensible model" this is meant to be.
  trigger_value numeric(12, 2) not null,
  -- Snapshot of the rule's threshold at trigger time, so a later threshold
  -- edit never retroactively changes what an already-triggered event
  -- displays. Null for data_delayed (no user threshold).
  threshold_value numeric(12, 2),
  notification_sent_at timestamptz,
  resolved_at timestamptz
);

create index alert_events_connection_id_idx on public.alert_events (connection_id);

-- The dedup query for low_balance/data_delayed: "is there already an active
-- event for this rule". Partial index keeps it cheap regardless of how many
-- resolved historical events accumulate.
create index alert_events_active_per_rule_idx
  on public.alert_events (alert_rule_id)
  where resolved_at is null;

-- The dedup query for daily_spend/daily_kwh: "does today already have an
-- event for this rule". Enforced as a real constraint, not just an
-- index+application check, so a race between two near-simultaneous syncs
-- (manual + automatic) can never both insert a same-day event -- the second
-- insert simply fails uniqueness and the evaluator treats that as "already
-- notified today", not an error.
create unique index alert_events_one_per_rule_per_day_idx
  on public.alert_events (alert_rule_id, period_date)
  where period_date is not null;

alter table public.alert_events enable row level security;

-- Read-only for the owner (same shape as capture_runs: users can see their
-- own alert history if a future UI exposes it, but every write goes through
-- the service-role evaluator in src/lib/newinmeter/alerts.ts). A browser can
-- never fabricate a system-triggered event -- there is no authenticated
-- insert/update/delete policy at all.
create policy "alert events are readable by owner"
  on public.alert_events for select to authenticated
  using (connection_id = public.my_livemopay_connection_id());

revoke all on public.alert_events from anon, authenticated;
grant select on public.alert_events to authenticated;

-- No backfill, no auto-enabling: every existing connection simply has zero
-- alert_rules rows after this migration, which the application treats as
-- "nothing configured" -- no notification is ever sent for a type with no
-- row, or with enabled = false. Existing push_subscriptions are untouched.
