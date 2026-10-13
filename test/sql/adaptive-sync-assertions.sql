-- Run after adaptive-sync-fixture.sql and the actual migration in a disposable database.
insert into livemopay_connections(id,user_id,account_id,company_id,property_id,refresh_token_ciphertext,next_sync_at) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000099','test','test','test','test',now()-interval '1 hour');
insert into dashboard_summary(connection_id) values('00000000-0000-4000-8000-000000000001');
select * from start_capture_run('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','incremental','manual');
do $$declare n integer; payload jsonb := '[{"capture_dt":"13/10/2026 12:00","charge_label":"Energy Charge:","period_dt":"2026-10-13 11:30","kwh":0.1,"water_kl":0,"tariff":2.5,"cost":0.25,"balance":100,"source_ts":"2026-10-13T10:00:00Z"}]';begin
 n:=upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',payload);
 if n<>1 then raise exception 'new row count wrong';end if;
 n:=upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',payload);
 if n<>1 then raise exception 'lost-response retry count wrong';end if;
 update capture_runs set rows_changed=1,status='success',finished_at=now() where id='00000000-0000-4000-8000-000000000011';
 if (select count(*) from refresh_calls)<>1 then raise exception 'changed run did not refresh';end if;
 perform * from start_capture_run('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','incremental','manual');
 n:=upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012',payload);
 if n<>0 then raise exception 'unchanged row was written';end if;
 update capture_runs set rows_changed=0,status='success',finished_at=now() where id='00000000-0000-4000-8000-000000000012';
 if (select count(*) from refresh_calls)<>1 then raise exception 'unchanged run refreshed';end if;
 if (select sync_run_id from dashboard_summary) <> '00000000-0000-4000-8000-000000000012'::uuid then raise exception 'successful empty check left dashboard stale';end if;
 perform * from start_capture_run('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','incremental','manual');
 n:=upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000013',jsonb_set(payload,'{0,kwh}','0.2'));
 if n<>1 then raise exception 'correction not written';end if;
 update capture_runs set rows_changed=1,status='success',finished_at=now() where id='00000000-0000-4000-8000-000000000013';
 perform * from start_capture_run('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000001','incremental','manual');
 n:=upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000014',jsonb_set(payload,'{0,kwh}','0.2'),true);
 if n<>1 then raise exception 'refund cleanup refresh not retained';end if;
 update capture_runs set rows_changed=1,status='success',finished_at=now() where id='00000000-0000-4000-8000-000000000014';
end;$$;
insert into capture_runs(id,connection_id,mode,trigger,status,started_at) select gen_random_uuid(),'00000000-0000-4000-8000-000000000001','incremental','auto','failed',now()-interval '2 hours' from generate_series(1,24);
do $$begin
 if exists(select * from claim_due_auto_sync_connections(10)) then raise exception 'over-budget connection claimed';end if;
 if (select next_sync_at from livemopay_connections where id='00000000-0000-4000-8000-000000000001') <= now() then raise exception 'budget deferral not applied';end if;
 begin perform * from start_capture_run(gen_random_uuid(),'00000000-0000-4000-8000-000000000001','incremental','auto');raise exception 'budget bypass';exception when sqlstate 'P0001' then if sqlerrm <> 'Automatic sync daily budget reached' then raise;end if;end;
end;$$;
insert into livemopay_connections(id,user_id,account_id,company_id,property_id,refresh_token_ciphertext,next_sync_at,paused) values('00000000-0000-4000-8000-000000000002',gen_random_uuid(),'test','test','test','test',now()-interval '1 hour',true);
do $$begin if exists(select * from claim_due_auto_sync_connections(10)) then raise exception 'paused connection claimed';end if;end;$$;
update livemopay_connections set paused=false,data_state='cold' where id='00000000-0000-4000-8000-000000000002';
do $$begin if exists(select * from claim_due_auto_sync_connections(10)) then raise exception 'cold connection claimed';end if;end;$$;
update livemopay_connections set data_state='warm',is_demo=true where id='00000000-0000-4000-8000-000000000002';
do $$begin if exists(select * from claim_due_auto_sync_connections(10)) then raise exception 'demo connection claimed';end if;end;$$;
update livemopay_connections set is_demo=false where id='00000000-0000-4000-8000-000000000002';
do $$begin if not exists(select * from claim_due_auto_sync_connections(10)) then raise exception 'eligible connection not claimed';end if; if exists(select * from claim_due_auto_sync_connections(10)) then raise exception 'lease did not exclude duplicate';end if;end;$$;
do $$begin if has_function_privilege('anon','public.upsert_changed_energy_rows(uuid,uuid,jsonb,boolean)','execute') or has_function_privilege('authenticated','public.start_capture_run(uuid,uuid,text,text)','execute') then raise exception 'privilege leak';end if;end;$$;
-- An interrupted run may have written rows without refreshing rollups.
update livemopay_connections set sync_claimed_at=null where id='00000000-0000-4000-8000-000000000002';
select * from start_capture_run('00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000001','incremental','manual');
update energy_rows set sync_run_id='00000000-0000-4000-8000-000000000015';
update capture_runs set status='failed' where id='00000000-0000-4000-8000-000000000015';
select * from start_capture_run('00000000-0000-4000-8000-000000000016','00000000-0000-4000-8000-000000000001','incremental','manual');
do $$declare n integer;begin
 select upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000016',jsonb_agg(jsonb_build_object('capture_dt',capture_dt,'charge_label',charge_label,'period_dt',period_dt,'kwh',kwh,'water_kl',water_kl,'tariff',tariff,'cost',cost,'balance',balance,'source_ts',source_ts))) into n from energy_rows;
 if n<>1 then raise exception 'failed-run writes were not recovered';end if;
end;$$;
-- No live HTTP is performed: the fixture's net.http_post records calls.
delete from http_calls;
update livemopay_connections set next_sync_at=now()+interval '2 hours';
select trigger_newinmeter_auto_sync();
do $$begin
 if (select count(*) from http_calls) <> (case when extract(minute from now())::integer % 10 = 0 then 1 else 0 end) then raise exception 'empty tick did not respect maintenance cadence';end if;
end;$$;
delete from http_calls;
update livemopay_connections set next_sync_at=now()-interval '1 minute',sync_claimed_at=null where id='00000000-0000-4000-8000-000000000002';
select trigger_newinmeter_auto_sync();
do $$begin if (select count(*) from http_calls)<>1 then raise exception 'due work did not wake HTTP worker';end if;end;$$;
select 'All SQL assertions passed' as result;
