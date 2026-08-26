-- Privacy-conscious product engagement. This deliberately records only one
-- foreground-presence row per user/day and one aggregate AI adoption row per
-- user. Routes, clicks, prompts, devices, IPs and background work are absent.

-- Existing roles already identify admins. This extra flag is the reusable,
-- non-email-based escape hatch for future system/test accounts. Demo users
-- remain identifiable through livemopay_connections.is_demo.
alter table public.user_roles
  add column engagement_excluded boolean not null default false;

comment on column public.user_roles.engagement_excluded is
  'Excludes system/test accounts from product engagement metrics; admins and demo connections are excluded separately.';

create table public.user_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

comment on table public.user_activity_days is
  'One row per authenticated user per SAST calendar day when the app was genuinely visible in the foreground.';

-- DAU/WAU/MAU filter by a date range and then distinct user_id. The primary
-- key is user-first for ownership; this companion index is date-first for
-- the admin aggregate.
create index user_activity_days_date_user_idx
  on public.user_activity_days (activity_date, user_id);

alter table public.user_activity_days enable row level security;

create policy "activity days are readable by owner"
  on public.user_activity_days for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "today activity is insertable by owner"
  on public.user_activity_days for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    and activity_date = (now() at time zone 'Africa/Johannesburg')::date
  );

create policy "today activity is updatable by owner"
  on public.user_activity_days for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and activity_date = (now() at time zone 'Africa/Johannesburg')::date
  );

revoke all on public.user_activity_days from anon, authenticated, service_role;
grant select, insert, update on public.user_activity_days to authenticated;
-- Admin aggregation is read-only. Background service-role code is therefore
-- incapable of inserting or updating foreground activity even accidentally.
grant select on public.user_activity_days to service_role;

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
$$;

revoke all on function public.record_user_activity() from public, anon, service_role;
grant execute on function public.record_user_activity() to authenticated;

-- Successful AI answers have no durable domain row today. Keep only the
-- aggregate adoption signal; prompt/response content is intentionally absent.
create table public.user_feature_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  first_used_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  usage_count integer not null default 1,
  primary key (user_id, feature),
  constraint user_feature_usage_feature_check check (feature in ('ai')),
  constraint user_feature_usage_count_check check (usage_count > 0)
);

create index user_feature_usage_feature_user_idx
  on public.user_feature_usage (feature, user_id);

alter table public.user_feature_usage enable row level security;
revoke all on public.user_feature_usage from anon, authenticated;
grant select, insert, update on public.user_feature_usage to service_role;

create or replace function public.record_user_feature_usage(p_user_id uuid, p_feature text)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  insert into public.user_feature_usage (user_id, feature)
  values (p_user_id, p_feature)
  on conflict (user_id, feature)
  do update set
    last_used_at = now(),
    usage_count = public.user_feature_usage.usage_count + 1;
$$;

revoke all on function public.record_user_feature_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.record_user_feature_usage(uuid, text) to service_role;
