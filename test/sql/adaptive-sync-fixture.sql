-- Minimal disposable Postgres fixture for scheduler and ingestion contract tests.
-- The production rollup function is represented by a call counter here.
create role anon; create role authenticated; create role service_role;
create schema vault; create schema extensions; create schema net;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create table public.livemopay_connections(id uuid primary key,user_id uuid,account_id text,company_id text,property_id text,refresh_token_ciphertext text,refresh_token_iv text,refresh_token_auth_tag text,status text default 'connected',data_state text default 'warm',is_demo boolean default false,auto_sync_enabled boolean default true,next_sync_at timestamptz,sync_claimed_at timestamptz,paused boolean default false);
create table public.capture_runs(id uuid primary key,connection_id uuid references livemopay_connections(id),mode text,trigger text,status text,started_at timestamptz default now(),finished_at timestamptz,rows_in_csv integer,rows_synced integer);
create unique index capture_runs_one_running_per_connection on capture_runs(connection_id) where status='running';
create table public.energy_rows(id bigint generated always as identity primary key,connection_id uuid references livemopay_connections(id),capture_dt text,charge_label text,period_dt text,kwh numeric(12,4),water_kl numeric(12,4),tariff numeric(12,4),cost numeric(12,2),balance numeric(12,2),source_ts timestamptz,tariff_band text,sync_run_id uuid references capture_runs(id),last_seen_at timestamptz,unique(connection_id,charge_label,period_dt,cost,balance));
create table refresh_calls(run_id uuid);
create function handle_newinmeter_capture_run_refresh() returns trigger language plpgsql as $$begin insert into refresh_calls values(new.id);return new;end;$$;
create function auto_sync_is_paused_for_inactivity(uuid) returns boolean language sql as $$select paused from livemopay_connections where id=$1$$;
grant select,insert,update on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;

create table public.http_calls(url text);
create or replace function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin insert into public.http_calls values(url);return 1;end;$$;
insert into vault.decrypted_secrets values('newinmeter_auto_sync_url','https://example.invalid/worker'),('newinmeter_auto_sync_secret','test-secret');

create table dashboard_summary(connection_id uuid primary key,last_synced_at timestamptz,rows_in_csv integer,rows_synced integer,updated_at timestamptz,sync_run_id uuid);
grant select,update on dashboard_summary to service_role;
