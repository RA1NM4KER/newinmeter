-- Bounded response: one foreground-activity timestamp per user, not activity history.
-- Admin API only; no new browser access and no lifecycle policy changes.
create function public.admin_user_last_activity()
returns table (user_id uuid, last_seen_at timestamptz)
language sql stable security invoker
set search_path = ''
as $$
  select d.user_id, max(d.last_seen_at)
  from public.user_activity_days d
  group by d.user_id;
$$;
revoke all on function public.admin_user_last_activity() from public, anon, authenticated;
grant execute on function public.admin_user_last_activity() to service_role;
