-- Minimal, privacy-conscious onboarding funnel. Aggregate daily counters
-- only: one row per (day, event_type), no user id, no session id, no IP,
-- no route, no free text. This exists to answer "where do people stop
-- between clicking the login page and connecting LiveMopay", not to build a
-- general analytics pipeline -- see src/lib/funnel.ts for the write path.

create table public.onboarding_funnel_daily (
  event_date date not null,
  event_type text not null,
  event_count integer not null default 0,
  primary key (event_date, event_type),
  constraint onboarding_funnel_event_type_check check (event_type in (
    'login_page_viewed',
    'public_demo_started',
    'demo_reached',
    'sign_in_started',
    'sign_in_completed',
    'connect_screen_viewed',
    'connect_attempted',
    'connect_invalid_credentials',
    'connect_succeeded',
    'initial_sync_succeeded',
    'initial_sync_failed'
  )),
  constraint onboarding_funnel_count_check check (event_count > 0)
);

comment on table public.onboarding_funnel_daily is
  'Aggregate daily counts for onboarding funnel steps. No user id, session id, IP, or route is ever stored here.';

-- Single write path: increments today's counter for one allow-listed event
-- type. security definer so it can run for anonymous (pre-auth) callers via
-- the service-role-backed /api/funnel/track route, without granting that
-- route (or anon/authenticated directly) any broader table access.
create or replace function public.record_funnel_event(p_event_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.onboarding_funnel_daily (event_date, event_type, event_count)
  values ((now() at time zone 'Africa/Johannesburg')::date, p_event_type, 1)
  on conflict (event_date, event_type)
  do update set event_count = public.onboarding_funnel_daily.event_count + 1;
end;
$$;

revoke all on function public.record_funnel_event(text) from public, anon, authenticated;
grant execute on function public.record_funnel_event(text) to service_role;

alter table public.onboarding_funnel_daily enable row level security;
revoke all on public.onboarding_funnel_daily from anon, authenticated;
grant select on public.onboarding_funnel_daily to service_role;
