-- Automatic LiveMopay sync scheduling.
--
-- This adds a second, distinct concurrency layer on top of the existing
-- capture_runs_one_running_per_connection lock (see
-- 20260725020000_livenopay_enforce_ownership.sql). That lock stops two
-- *actual* LiveMopay sync executions from overlapping for one connection.
-- It says nothing about two overlapping *scheduler* invocations both
-- deciding the same connection is due and both trying to dispatch it --
-- that's what claim_due_auto_sync_connections() below is for. The two
-- layers are independent and both stay in place:
--
--   scheduler claim (sync_claimed_at)  -> prevents two scheduler ticks
--                                          dispatching the same due job
--   capture_runs unique running index  -> prevents actual sync executions
--                                          overlapping (unchanged)

-- ---------------------------------------------------------------------------
-- 1. Connection-level auto-sync state
-- ---------------------------------------------------------------------------

alter table public.livemopay_connections
  -- Defaults to true so a normal connected account is scheduled automatically
  -- without any explicit opt-in. Demo connections are excluded by status/
  -- is_demo checks everywhere this is read, not by this default.
  add column auto_sync_enabled boolean not null default true,
  -- When this connection's next automatic sync is due. Null means "not
  -- currently scheduled" (auto-sync off, never connected, disconnected, or
  -- needs reauth) -- claim_due_auto_sync_connections() only ever selects
  -- rows where this is set and in the past.
  add column next_sync_at timestamptz,
  -- Automatic-sync-specific mirror of last_synced_at/last_error (which stay
  -- the general "last sync of any kind" fields, updated by both manual and
  -- automatic syncs). These track the automatic path specifically, so the
  -- UI can say "last automatic update" without conflating it with a manual
  -- refresh the user just triggered themselves.
  add column last_auto_sync_at timestamptz,
  add column last_auto_sync_status text,
  add column last_auto_sync_error text,
  -- Scheduler claim lease. Set by claim_due_auto_sync_connections() when a
  -- worker invocation claims this connection, cleared by the worker once it
  -- finishes (success, failure, or SyncAlreadyRunningError). A claim older
  -- than the TTL passed to the claim function is treated as abandoned (crash,
  -- timeout, deployment) and becomes reclaimable again -- see "claim expiry"
  -- below. This is scheduler bookkeeping only; it never gates manual sync.
  add column sync_claimed_at timestamptz,
  -- Minimal scaffolding for the future alert system: whether this user wants
  -- alert evaluation to run after a successful automatic sync. No alert
  -- engine exists yet -- this is only a persisted preference bit so Settings
  -- has somewhere to write it and the future evaluator has somewhere to read
  -- it from. Defaults false: alerts are opt-in, auto-sync is opt-out.
  add column alerts_enabled boolean not null default false;

alter table public.livemopay_connections
  add constraint livemopay_connections_last_auto_sync_status_check
    check (last_auto_sync_status is null or last_auto_sync_status in ('success', 'failed'));

-- Backfills next_sync_at for every existing connected, non-demo account so
-- automatic syncing starts working immediately after this migration rather
-- than waiting for someone to flip a toggle. now() rather than a computed
-- window is deliberate: it makes every existing account immediately due, so
-- the very next scheduler tick picks it up, records a real
-- last_auto_sync_at, and from then on next_sync_at follows the normal
-- deterministic 4-window schedule (see src/lib/newinmeter/schedule.ts).
update public.livemopay_connections
set next_sync_at = now()
where status = 'connected'
  and is_demo = false
  and auto_sync_enabled = true;

-- Supports the claim query's WHERE clause directly (status/is_demo/
-- auto_sync_enabled are all equality checks the planner can use as index
-- predicates, next_sync_at is the range/order column).
create index livemopay_connections_auto_sync_due_idx
  on public.livemopay_connections (next_sync_at)
  where status = 'connected' and is_demo = false and auto_sync_enabled = true;

-- ---------------------------------------------------------------------------
-- 2. Atomic due-connection claim
-- ---------------------------------------------------------------------------

-- Atomically selects up to p_limit due, unclaimed (or stale-claimed)
-- connections and marks them claimed, in one statement. The FOR UPDATE SKIP
-- LOCKED select and the UPDATE that stamps sync_claimed_at happen inside a
-- single SQL statement, so two concurrent invocations (e.g. two overlapping
-- scheduler ticks, or a retried pg_net call) can never both claim the same
-- row: whichever one's SELECT runs first locks the matching rows, the other
-- skips them.
--
-- p_claim_ttl bounds how long a claim survives an abandoned worker (Vercel
-- timeout, deployment, crash, uncaught exception before it can release its
-- own claim). Pick it comfortably longer than a real automatic sync ever
-- takes -- incremental syncs are small and fast, but this also has to
-- survive a cold start. The worker itself always releases its claim as soon
-- as it finishes (success, failure, or SyncAlreadyRunningError), so the TTL
-- is a crash-recovery backstop, not the normal release path.
--
-- Demo connections (is_demo = true) are excluded here, at the claim source,
-- not just in the worker or the UI -- runLivemopaySync() must never be
-- reachable for a demo connection through any path.
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
as $$
  with due as (
    select c.id
    from public.livemopay_connections c
    where c.status = 'connected'
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
    limit p_limit
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

-- Same trust boundary as finish_capture_run: only ever invoked with the
-- service-role key from the internal worker route, never from the browser.
-- The returned refresh-token ciphertext is meaningless without
-- NEWINMETER_TOKEN_ENCRYPTION_KEY (a server-only env var), and this grant
-- keeps it unreachable from anon/authenticated regardless.
revoke all on function public.claim_due_auto_sync_connections(integer, interval) from public;
grant execute on function public.claim_due_auto_sync_connections(integer, interval) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Supabase Cron: one lightweight scheduler tick, not one job per user
-- ---------------------------------------------------------------------------
--
-- pg_cron fires every 5 minutes and calls a tiny SQL function that POSTs
-- (via pg_net) to the app's own protected /api/cron/auto-sync route. That
-- route is the one place that actually looks at next_sync_at, claims a
-- bounded batch, and dispatches them -- pg_cron itself never contacts
-- LiveMopay and never runs per-user.
--
-- Vercel Cron already exists in this project (vercel.json ->
-- /api/cron/stale-check) but only supports once-daily invocations, so it
-- cannot drive a 5-minute scheduler tick -- that's the concrete platform
-- constraint for using pg_cron here instead of a second Vercel Cron entry.
-- There remains exactly one scheduling authority for auto-sync: pg_cron.
--
-- Requires the pg_cron and pg_net extensions, which on a hosted Supabase
-- project are usually already available but may need enabling once via
-- Dashboard -> Database -> Extensions if this migration fails on the lines
-- below with an insufficient-privilege error.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Reads the worker URL and bearer secret from Supabase Vault rather than
-- embedding them in migration source (which would commit production
-- credentials to the repo). These two secrets must be created once per
-- environment -- see MULTI_USER_SETUP.md "Automatic sync scheduling" for the
-- exact one-time `select vault.create_secret(...)` commands to run in the
-- Supabase SQL editor. Until they exist, this function is a safe no-op: it
-- logs and returns rather than erroring, so pg_cron ticking with no secrets
-- configured yet (e.g. right after this migration, before the manual Vault
-- step) never fails loudly every 5 minutes.
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

-- cron.schedule(job_name, schedule, command) upserts when job_name already
-- exists (pg_cron >= 1.4), so re-running this migration is safe and keeps
-- the schedule reproducible from source rather than permanent manual
-- dashboard configuration.
select cron.schedule(
  'newinmeter-auto-sync-worker',
  '*/5 * * * *',
  $$select public.trigger_newinmeter_auto_sync();$$
);
