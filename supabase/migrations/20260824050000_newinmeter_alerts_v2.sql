-- Alerts v2: five new alert types (balance_runway, monthly_budget,
-- tariff_changed, tariff_band_approaching, usage_anomaly) on top of the
-- existing alert_rules/alert_events model from 20260824020000. No new
-- tables for "notifications" or "tariff rules engine" -- alert_events stays
-- the one source of truth, just carrying a bit more context than the four
-- original types needed.
--
-- Everything here is additive and backward-compatible: existing
-- low_balance/daily_spend/daily_kwh/data_delayed rows, their CHECK
-- constraints' shape, and every existing RLS policy/grant are preserved
-- exactly. No existing row is touched except the tariff_profile backfill at
-- the very end, which is a nullable column addition + a scoped UPDATE, not
-- a rewrite of anything alert-related.

-- ---------------------------------------------------------------------------
-- alert_rules: widen type + threshold-by-type to the five new types
-- ---------------------------------------------------------------------------

alter table public.alert_rules
  drop constraint alert_rules_type_check;

alter table public.alert_rules
  add constraint alert_rules_type_check check (
    type in (
      'low_balance', 'daily_spend', 'daily_kwh', 'data_delayed',
      'balance_runway', 'monthly_budget', 'tariff_changed', 'tariff_band_approaching', 'usage_anomaly'
    )
  );

alter table public.alert_rules
  drop constraint alert_rules_threshold_by_type;

alter table public.alert_rules
  add constraint alert_rules_threshold_by_type check (
    (type = 'data_delayed' and threshold is null)
    or (type = 'low_balance' and threshold > 0 and threshold <= 1000000)
    or (type = 'daily_spend' and threshold > 0 and threshold <= 1000000)
    or (type = 'daily_kwh' and threshold > 0 and threshold <= 10000)
    -- Whole days, 1-30 -- see BALANCE_RUNWAY_BOUNDS in alert-types.ts.
    -- Stored in the same numeric(12,2) column as every other threshold
    -- (no new column) but constrained to an integer value here too, so a
    -- malformed direct write can't sneak in "2.5 days".
    or (type = 'balance_runway' and threshold = trunc(threshold) and threshold >= 1 and threshold <= 30)
    or (type = 'monthly_budget' and threshold > 0 and threshold <= 1000000)
    -- Observational/predictive types with no user-configurable number.
    or (type = 'tariff_changed' and threshold is null)
    or (type = 'tariff_band_approaching' and threshold is null)
    or (type = 'usage_anomaly' and threshold is null)
  );

-- ---------------------------------------------------------------------------
-- alert_events: richer context + a general dedup key
-- ---------------------------------------------------------------------------
--
-- period_date (existing) stays exactly what it was: the per-SAST-day dedup
-- key for daily_spend/daily_kwh, and now also usage_anomaly (same "one per
-- rule per local day" shape -- see alert_events_one_per_rule_per_day_idx,
-- unchanged).
--
-- dedup_key is new and more general: a free-form text key for the two new
-- alert families whose natural dedup scope isn't a single day --
-- monthly_budget ("2026-08") and tariff_band_approaching
-- ("newinbosch_2026_27:2026-08:300"). low_balance/balance_runway/
-- tariff_changed don't use it at all -- they stay on the existing
-- active-event (resolved_at is null) dedup pattern, which needs no new
-- column.
alter table public.alert_events
  add column dedup_key text,
  add column event_context jsonb,
  add column suppressed boolean not null default false;

create unique index alert_events_one_per_rule_per_dedup_key_idx
  on public.alert_events (alert_rule_id, dedup_key)
  where dedup_key is not null;

comment on column public.alert_events.event_context is
  'Snapshot of the values that were true when this event triggered (e.g. {"balance":143.5,"averageDailySpend":48.1,"estimatedDaysRemaining":2.98}). Notification copy is derived from this + trigger_value/threshold_value, never recomputed from today''s live data, so historical notifications stay accurate after thresholds/data change. Never contains anything not already visible to the owning user elsewhere in the product.';

comment on column public.alert_events.suppressed is
  'True for the losing half of a correlated pair (e.g. low_balance when balance_runway already fired this cycle -- see the correlation-suppression comment in evaluateAlertsAfterSync). The row still exists and still carries real durable dedup state (its own active-event/period_date/dedup_key), so the suppressed condition does not re-fire on the next sync -- but it is never surfaced in the Notification Centre or counted toward the unread badge, so one condition cluster produces exactly one user-visible notification.';

-- ---------------------------------------------------------------------------
-- alert_rule_state: small service-role-only evaluator memory
-- ---------------------------------------------------------------------------
--
-- Only tariff_changed needs this so far (it must remember the last
-- *observed* tariff to detect a change, and must establish a baseline on
-- first enable without notifying -- see evaluateTariffChanged). Every other
-- new alert type derives its trigger condition fresh from rollups/dashboard
-- data each run, so it doesn't need persistent evaluator state at all.
--
-- Deliberately not reachable by the browser at all -- same shape as
-- push_subscriptions (20260807000000): RLS on, zero policies, revoke from
-- anon and authenticated. service_role bypasses RLS by default in this
-- project (already relied on everywhere else in this file's own evaluator
-- code), so no explicit grant is needed for it either.
create table public.alert_rule_state (
  alert_rule_id uuid primary key references public.alert_rules(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.alert_rule_state enable row level security;

revoke all on public.alert_rule_state from anon, authenticated;

-- ---------------------------------------------------------------------------
-- tariff_profile: optional, versioned association on the connection
-- ---------------------------------------------------------------------------
--
-- Nullable text key into the code-side profile registry
-- (src/lib/newinmeter/tariff-profiles.ts) -- deliberately not a foreign key
-- into a new tariff_profiles table. The profile *definitions* (bands,
-- daily charges, effective dates) are versioned config in code, not data a
-- browser ever reads or writes; this column is just "which one, if any,
-- applies to this connection". A future second profile is a new registry
-- entry + a value some connections get assigned, not a schema change.
--
-- No default: a connection with no matching profile (unknown estate,
-- future non-Newinbosch users) simply has tariff_profile = null forever,
-- and tariff_band_approaching stays unavailable for it -- tariff_changed
-- (observational, no profile needed) still works for everyone regardless.
alter table public.livemopay_connections
  add column tariff_profile text;

-- Read-only for the owner, alongside every other connection field a user
-- can already see about their own connection via getConnectionForUser --
-- this is display-only (Settings hides/shows the band-approaching row based
-- on it) and never user-writable: nothing in this migration grants
-- authenticated any write path to it, and livemopay_connections itself has
-- no authenticated RLS policies at all (see its own migration) -- every
-- read of this column already goes through the existing service-role
-- getConnectionRowForUser, unchanged.

-- ---------------------------------------------------------------------------
-- Backfill: assign the current production cohort to newinbosch_2026_27
-- ---------------------------------------------------------------------------
--
-- Every real (non-demo) connection existing today is confirmed Newinbosch by
-- the product owner. Backfilling them unlocks tariff_band_approaching for
-- accounts that already exist -- WITHOUT enabling the alert itself (that
-- still requires the user to explicitly turn it on in Settings, per the
-- "no auto-enabling" rule above; tariff_profile is metadata about the
-- connection, not an alert_rules row).
--
-- Constrained to company_id = '43', not just is_demo = false. company_id is
-- a genuine LiveMopay-native identifier (read straight from LiveMopay's own
-- account-discovery response / Firebase ID token, never generated by this
-- app -- see discoverLiveMopayAccounts in src/lib/newinmeter/web.ts) rather
-- than something NewinMeter invented, and a read-only production query run
-- before writing this migration confirmed every one of the 13 real
-- connections that exist today -- across 10 distinct account_ids (3 of
-- which are shared by two connection rows apiece, e.g. two app users on
-- the same LiveMopay wallet) and 3 distinct property_ids -- shares this
-- exact same company_id. That spread (many accounts, several properties,
-- one company_id) is what makes it a credible estate-level grouping rather
-- than a per-account coincidence.
-- `is_demo = false` alone would have backfilled every future non-Newinbosch
-- signup too, silently, the moment one exists -- purely because "not the
-- demo account" was never a Newinbosch-specific fact, just true today by
-- coincidence (every real user so far happens to be one). Filtering on the
-- actual estate identifier means a future connection from a different
-- company_id is excluded automatically, with nothing further to remember.
--
-- One honest caveat, carried over from this codebase's own notes
-- (MULTI_USER_SETUP.md's "LiveMopay discovery uncertainties" section):
-- company_id's cross-owner stability has not been independently verified
-- against LiveMopay's real API beyond what's empirically observed in this
-- one production dataset. Re-run the query below immediately before this
-- migration is ever applied, to catch any drift since this was written:
--
--   select company_id, count(*), count(distinct account_id), count(distinct property_id)
--   from public.livemopay_connections where is_demo = false group by company_id;
--
-- Deliberately NOT a blanket default for every future connection: a new
-- LiveMopay signup from an unknown estate/municipality (a different
-- company_id, or is_demo = true) gets tariff_profile = null (see the column
-- comment above) until something explicitly assigns it a real profile.
-- Newinbosch is this migration's one-time backfill target, not the
-- fallback -- and nothing here couples the tariff_profile column itself,
-- or any evaluator code, to company_id at all; the constraint lives only
-- in this one-time UPDATE statement.
update public.livemopay_connections
set tariff_profile = 'newinbosch_2026_27'
where tariff_profile is null
  and is_demo = false
  and company_id = '43';

-- ---------------------------------------------------------------------------
-- No auto-enabling
-- ---------------------------------------------------------------------------
--
-- Nothing above inserts or updates a single alert_rules row. Every existing
-- connection has exactly the alert_rules rows it had before this migration
-- -- zero new rules, zero newly-enabled rules, zero new notifications for
-- any existing user until they explicitly turn one of these on themselves.
