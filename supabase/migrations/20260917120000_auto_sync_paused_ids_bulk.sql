-- Bulk companion to auto_sync_is_paused_for_inactivity: the diagnostics
-- page needs to know, for every connected/warm connection at once, whether
-- it's paused for inactivity, and calling the single-connection function
-- once per row would be an N+1 RPC round trip for every page load. Same
-- predicate, same 14-day default, just evaluated for the whole set in one
-- query instead of one function call per connection.
create or replace function public.auto_sync_paused_connection_ids(
  p_inactive_for interval default interval '14 days'
)
returns table (connection_id uuid)
language sql
stable
security definer
set search_path = public, auth
as $$
  select c.id as connection_id
  from public.livemopay_connections c
  join auth.users u on u.id = c.user_id
  left join lateral (
    select max(d.last_seen_at) as last_seen_at
    from public.user_activity_days d
    where d.user_id = c.user_id
  ) activity on true
  where c.status = 'connected'
    and coalesce(activity.last_seen_at, greatest(u.last_sign_in_at, c.connected_at)) <= now() - p_inactive_for
    and not c.alerts_enabled
    and not exists (
      select 1 from public.alert_rules ar
      where ar.connection_id = c.id and ar.enabled
    );
$$;

revoke all on function public.auto_sync_paused_connection_ids(interval) from public, anon, authenticated;
grant execute on function public.auto_sync_paused_connection_ids(interval) to service_role;
