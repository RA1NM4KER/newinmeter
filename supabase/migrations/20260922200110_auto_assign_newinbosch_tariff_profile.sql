-- Connection creation and account selection now assign this profile from
-- the explicit company-to-profile registry in tariff-profiles.ts. Catch up
-- the final connection created before that behavior shipped. The predicate
-- is idempotent and continues to exclude demo and unknown-company accounts.
update public.livemopay_connections
set tariff_profile = 'newinbosch_2026_27'
where tariff_profile is null
  and is_demo = false
  and company_id = '43';
