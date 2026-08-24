-- Redesigns per-user feature flags (ai_assistant_enabled, activities_enabled,
-- live_meter_enabled on user_roles) into a proper global-rollout + per-user-
-- override model, and adds Alerts as a fourth revocable feature.
--
-- Resolution rule (enforced in app code, src/lib/features.ts):
--   rollout = 'off'               -> access = false, for everyone
--   user has an explicit override -> access = override
--   otherwise                     -> access = (rollout = 'everyone')
--
-- Same "service-role only, no policies" posture as user_roles and
-- alert_rule_state: every access goes through adminSupabaseFetch/Request,
-- never a user's own token, so RLS-on-with-zero-policies is default-deny
-- without needing any actual policy.

create table public.feature_rollouts (
  feature_key text primary key check (feature_key in ('ai', 'activities', 'live', 'alerts')),
  rollout_mode text not null check (rollout_mode in ('everyone', 'selected', 'off')),
  updated_at timestamptz not null default now()
);

alter table public.feature_rollouts enable row level security;
revoke all on public.feature_rollouts from anon, authenticated;

create table public.feature_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null references public.feature_rollouts(feature_key),
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_key)
);

alter table public.feature_overrides enable row level security;
revoke all on public.feature_overrides from anon, authenticated;

create index feature_overrides_feature_key_idx on public.feature_overrides (feature_key);

-- Seed rollout modes matching each feature's actual current-production
-- access pattern, so the migration below preserves effective access exactly:
--   ai         -- was default-on (ai_assistant_enabled default true); every
--                 production row is true today -> 'everyone', no overrides.
--   activities -- was default-off, opt-in per user -> 'selected'.
--   live       -- was default-off, opt-in per user, currently nobody has it
--                 -> 'selected'.
--   alerts     -- had no per-user flag at all; generally available to every
--                 user already -> 'everyone', so it stays available.
insert into public.feature_rollouts (feature_key, rollout_mode) values
  ('ai', 'everyone'),
  ('activities', 'selected'),
  ('live', 'selected'),
  ('alerts', 'everyone');

-- Migrate existing per-user divergence from the new default into explicit
-- overrides. Data-driven off the live user_roles columns (not a hardcoded
-- user list), so this is correct regardless of exactly which rows exist at
-- apply time -- only rows that would otherwise change access get an
-- override; a user_roles row that already matches the seeded default for
-- its feature needs no override row at all.
insert into public.feature_overrides (user_id, feature_key, enabled)
select user_id, 'ai', ai_assistant_enabled
from public.user_roles
where ai_assistant_enabled = false; -- rollout is 'everyone' (default true); only false diverges

insert into public.feature_overrides (user_id, feature_key, enabled)
select user_id, 'activities', true
from public.user_roles
where activities_enabled = true; -- rollout is 'selected' (default false); only true diverges

insert into public.feature_overrides (user_id, feature_key, enabled)
select user_id, 'live', true
from public.user_roles
where live_meter_enabled = true; -- rollout is 'selected' (default false); only true diverges

-- Alerts had no per-user column to migrate from -- every existing user keeps
-- access purely via the 'everyone' rollout, matching their current
-- (ungated) access.

alter table public.user_roles
  drop column ai_assistant_enabled,
  drop column activities_enabled,
  drop column live_meter_enabled;
