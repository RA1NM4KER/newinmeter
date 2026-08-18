-- Demo/recruiter account support. An explicit marker on the connection row
-- (rather than a parallel data model) lets a seeded demo connection flow
-- through every normal connection-scoped path unchanged -- dashboard
-- loaders, analytics rollups, Activities, the assistant, and RLS -- while
-- giving the sync route, the connect/disconnect routes, account deletion,
-- and the stale-check cron a single server-side fact to check before ever
-- touching LiveMopay or letting the shared credential destroy itself.
--
-- No RLS policy changes: livemopay_connections already has zero
-- authenticated policies (service-role only, ownership enforced in code --
-- see the connections migration), so is_demo is read the same way every
-- other column on this table already is.
--
-- See scripts/seed-demo-account.ts and the README "Demo account" section.

alter table public.livemopay_connections
  add column is_demo boolean not null default false;
