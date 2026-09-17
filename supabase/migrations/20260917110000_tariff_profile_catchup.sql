-- Second pass of 20260824050000's tariff_profile backfill.
--
-- That migration deliberately assigned newinbosch_2026_27 only to the
-- cohort that existed at the time, on purpose, not an oversight: "Newinbosch
-- is this migration's one-time backfill target, not the fallback... a
-- future non-Newinbosch signup gets tariff_profile = null and stays that
-- way until something explicit assigns it." This is that explicit
-- assignment, reviewed and re-run now that the same freshness check that
-- migration's own comment mandates has been re-verified, not an automatic
-- or ongoing mechanism, see the discussion around why connect-time
-- auto-assignment is deliberately NOT being added alongside this.
--
-- Freshness re-check (mandated by the original migration, re-run
-- immediately before writing this one, per its own instructions):
--
--   select company_id, count(*), count(distinct account_id), count(distinct property_id)
--   from public.livemopay_connections where is_demo = false group by company_id;
--
-- Result: 21 real connections, all company_id = '43', 19 distinct
-- account_ids, 3 distinct property_ids. Zero drift from the original
-- migration's own findings, every real connection in this project is still
-- this one estate.
--
-- This predicate is self-limiting and safe to re-run again in the future
-- the same way: it only ever touches rows that are still null, is_demo =
-- false, and company_id = '43', so a second application can't re-touch or
-- double-apply to anything already assigned.
update public.livemopay_connections
set tariff_profile = 'newinbosch_2026_27'
where tariff_profile is null
  and is_demo = false
  and company_id = '43';
