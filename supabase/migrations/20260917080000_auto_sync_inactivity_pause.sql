-- Auto-sync inactivity pause: stop scheduling new background syncs for a
-- connection that's had no foreground activity in a while and has no
-- enabled alerts, without purging anything or touching data_state. This is
-- deliberately NOT the cold-storage lifecycle (45 days, purges detail data,
-- moves data_state warm -> hibernating -> cold): it's a much cheaper, much
-- earlier intervention that stops accumulating new rows for someone who's
-- clearly stopped checking, long before cold storage would ever purge what
-- already piled up. See docs/cold-storage-operations.md for how the two
-- relate.
--
-- Deliberately NOT a stored column/flag (an "auto_sync_paused_at" needs
-- something to set it AND something to clear it, which is exactly the kind
-- of state-drift bug this project has already hit once with the
-- hibernation claim timestamp). Instead this is a single, live-computed
-- predicate, copied from claim_cold_storage_candidates's own
-- activity+fallback+alerts-exemption pattern, so "who currently counts as
-- paused" can never drift between the claim RPC and anything that displays
-- it.

create or replace function public.auto_sync_is_paused_for_inactivity(
  p_connection_id uuid,
  p_inactive_for interval default interval '14 days'
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    coalesce(activity.last_seen_at, greatest(u.last_sign_in_at, c.connected_at)) <= now() - p_inactive_for
    and not c.alerts_enabled
    and not exists (
      select 1 from public.alert_rules ar
      where ar.connection_id = c.id and ar.enabled
    )
  from public.livemopay_connections c
  join auth.users u on u.id = c.user_id
  left join lateral (
    select max(d.last_seen_at) as last_seen_at
    from public.user_activity_days d
    where d.user_id = c.user_id
  ) activity on true
  where c.id = p_connection_id;
$$;

revoke all on function public.auto_sync_is_paused_for_inactivity(uuid, interval) from public, anon, authenticated;
grant execute on function public.auto_sync_is_paused_for_inactivity(uuid, interval) to service_role;

-- Same signature as before (CREATE OR REPLACE, not a new overload), the
-- only change is one more AND'd condition in the `due` CTE, ANDed onto the
-- existing c.auto_sync_enabled = true check, never replacing it: a
-- connection the user explicitly disabled must stay disabled regardless of
-- this predicate, and re-enabling it is still their own explicit action.
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
      and not public.auto_sync_is_paused_for_inactivity(c.id)
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

-- Resume path: `authenticated` has no grants on livemopay_connections at
-- all (ownership is enforced in code for that table, not RLS, see
-- src/lib/newinmeter/connection.ts), so record_user_activity() (security
-- invoker, runs as the visiting user) cannot touch it directly. This
-- separate security-definer function is the one narrow door: it resolves
-- auth.uid() itself (no caller-supplied id, so it can only ever touch the
-- calling user's own connection) and only rearms a connection whose
-- next_sync_at is abnormally stale.
--
-- Deliberately does NOT call auto_sync_is_paused_for_inactivity() to decide
-- whether to rearm: this runs in the same transaction as (and after) the
-- activity-day upsert in record_user_activity(), which would already have
-- refreshed last_seen_at to now() by the time this runs, making that
-- predicate self-invalidate (a freshly-active user would always evaluate as
-- "not paused" the moment the row it depends on gets updated). Checking
-- next_sync_at's own staleness instead sidesteps that ordering trap
-- entirely: the normal 4-window schedule never lets next_sync_at fall more
-- than about 7 hours in the past under healthy operation, so anything past
-- a full day almost certainly means it stopped being claimed for pause (or
-- disabled/disconnected/cold) reasons, not that it's merely between cron
-- ticks, and rearming a connection that's disabled/disconnected/cold is a
-- harmless no-op here since the WHERE clause already excludes those.
create or replace function public.rearm_stale_auto_sync()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.livemopay_connections c
  set next_sync_at = now()
  where c.user_id = (select auth.uid())
    and c.status = 'connected'
    and c.data_state = 'warm'
    and c.is_demo = false
    and c.auto_sync_enabled = true
    and (c.next_sync_at is null or c.next_sync_at < now() - interval '1 day');
$$;

revoke all on function public.rearm_stale_auto_sync() from public, anon, service_role;
grant execute on function public.rearm_stale_auto_sync() to authenticated;

-- The activity write and the rearm check now happen in the same client
-- call (no extra round trip): the very page load that shows a returning
-- user their app also arms an immediate resync, instead of waiting for the
-- next pg_cron tick (up to 5 minutes) to notice the activity row changed.
create or replace function public.record_user_activity()
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  insert into public.user_activity_days (user_id, activity_date, last_seen_at)
  values (
    (select auth.uid()),
    (now() at time zone 'Africa/Johannesburg')::date,
    now()
  )
  on conflict (user_id, activity_date)
  do update set last_seen_at = excluded.last_seen_at;

  select public.rearm_stale_auto_sync();
$$;

revoke all on function public.record_user_activity() from public, anon, service_role;
grant execute on function public.record_user_activity() to authenticated;
