-- Discardable local database ONLY. Verifies SQL behavior without production fixtures.
-- psql -v ON_ERROR_STOP=1 -d newinmeter_availability_test -f scripts/verify-electricity-availability.sql
\set ON_ERROR_STOP on
begin;
do $$ begin
  if current_database()<>'newinmeter_availability_test' then raise exception 'Use a disposable newinmeter_availability_test database'; end if;
end $$;
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.livemopay_connections(id uuid primary key);
create table public.capture_runs(id uuid primary key,connection_id uuid not null references public.livemopay_connections(id),status text,rows_fetched integer,rows_changed integer,upstream_latest_at timestamptz,predicted_next_at timestamptz);
grant usage on schema public to service_role;
grant select,update on public.capture_runs to service_role;
\ir ../supabase/migrations/20261017121714_passive_electricity_availability.sql
insert into public.livemopay_connections values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.capture_runs values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','running',null,null,null,null);
set local role service_role;
do $$ declare ok boolean; begin
  ok:=public.record_capture_metadata('00000000-0000-0000-0000-000000000003',
    '{"rows_fetched":1,"rows_changed":1,"upstream_latest_at":null,"predicted_next_at":null}',
    jsonb_build_object('version',1,'items','[]'::jsonb,'fetchFinishedAt',now()));
  if ok is distinct from true then raise exception 'Record failed';end if;
  perform public.record_capture_metadata('00000000-0000-0000-0000-000000000003',null,
    jsonb_build_object('version',1,'items','[]'::jsonb,'fetchFinishedAt',now()));
  if (select count(*) from public.electricity_fetch_observations)<>1 then raise exception 'Retry not idempotent';end if;
  if (select connection_id from public.electricity_fetch_observations)<>'00000000-0000-0000-0000-000000000001'::uuid then raise exception 'Ownership not derived from capture';end if;
end $$;
reset role;
-- Failed diagnostic validation must preserve capture metadata and stay fail-open.
insert into public.capture_runs values('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','running',null,null,null,null);
set local role service_role;
do $$ declare ok boolean; begin
  ok:=public.record_capture_metadata('00000000-0000-0000-0000-000000000004','{"rows_fetched":7,"rows_changed":0}',
    jsonb_build_object('version',1,'items','[]'::jsonb,'fetchFinishedAt',now(),'tooLarge',repeat('x',70000)));
  if ok is distinct from false then raise exception 'Oversized diagnostic was accepted';end if;
  if (select rows_fetched from public.capture_runs where id='00000000-0000-0000-0000-000000000004')<>7 then raise exception 'Metadata lost';end if;
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon','public.electricity_fetch_observations','SELECT')
    or has_table_privilege('authenticated','public.electricity_fetch_observations','SELECT')
    or has_function_privilege('authenticated','public.record_capture_metadata(uuid,jsonb,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.prune_electricity_observations()','EXECUTE')
    then raise exception 'Unexpected client privilege';end if;
end $$;
-- Force cap and age fixtures, then exercise the same insertion/pruning path.
insert into public.capture_runs(id,connection_id,status)
  select md5(i::text)::uuid,'00000000-0000-0000-0000-000000000001','failed' from generate_series(1,1030) i;
insert into public.electricity_fetch_observations
  select id,connection_id,now()-interval '31 days',jsonb_build_object('version',1,'items','[]'::jsonb,'fetchFinishedAt',now()-interval '31 days') from public.capture_runs where status='failed';
set local role service_role;
select public.record_capture_metadata('00000000-0000-0000-0000-000000000003',null,jsonb_build_object('version',1,'items','[]'::jsonb,'fetchFinishedAt',now()));
do $$ begin
  if (select count(*) from public.electricity_fetch_observations where connection_id='00000000-0000-0000-0000-000000000001')>1024 then raise exception 'Cap exceeded';end if;
  perform public.prune_electricity_observations();
  if exists(select 1 from public.electricity_fetch_observations where observed_at<now()-interval '30 days') then raise exception 'TTL failed';end if;
end $$;
reset role;
delete from public.capture_runs where id='00000000-0000-0000-0000-000000000003';
do $$ begin if exists(select 1 from public.electricity_fetch_observations) then raise exception 'Cascade failed';end if;end $$;
rollback;
select 'availability SQL checks passed' as result;
