-- Run after the adaptive scheduler assertions and reconciliation migration.
update capture_runs set status='failed',finished_at=now() where status='running';
select * from start_capture_run('00000000-0000-4000-8000-000000000017','00000000-0000-4000-8000-000000000001','incremental','manual');
do $$declare n integer; payload jsonb;begin
 select jsonb_agg(jsonb_build_object('capture_dt',capture_dt,'charge_label',charge_label,'period_dt',period_dt,'kwh',kwh,'water_kl',water_kl,'tariff',tariff,'cost',cost,'balance',balance+0.01,'source_ts',source_ts,'reconcile_key',true)) into payload from energy_rows;
 n:=upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000017',payload);
 if n<>1 or (select count(*) from energy_rows)<>1 then raise exception 'key correction duplicated consumption';end if;
 if (select count(*) from ledger_reconciliation_audit)<>1 then raise exception 'old entry not preserved';end if;
 n:=upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000017',payload);
 if n<>1 or (select count(*) from ledger_reconciliation_audit)<>1 then raise exception 'retry archived duplicate';end if;
 update capture_runs set status='success',finished_at=now(),rows_changed=1 where id='00000000-0000-4000-8000-000000000017';
 perform * from start_capture_run('00000000-0000-4000-8000-000000000018','00000000-0000-4000-8000-000000000001','incremental','manual');
 n:=upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000018',jsonb_set(jsonb_set(payload,'{0,source_ts}','"2026-10-13T11:00:00Z"'),'{0,cost}','0.30'));
 if (select count(*) from energy_rows)<>2 then raise exception 'different real event was erased';end if;
 update capture_runs set status='success',finished_at=now(),rows_changed=1 where id='00000000-0000-4000-8000-000000000018';
 perform * from start_capture_run('00000000-0000-4000-8000-000000000019','00000000-0000-4000-8000-000000000001','incremental','manual');
 n:=upsert_changed_energy_rows('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000019',jsonb_set(jsonb_set(payload,'{0,balance}','100.02'),'{0,reconcile_key}','false'));
 if (select count(*) from energy_rows)<>3 then raise exception 'ambiguous event was guessed away';end if;
end;$$;
do $$begin
 if has_table_privilege('anon','ledger_reconciliation_audit','select') or has_table_privilege('authenticated','ledger_reconciliation_audit','select') then raise exception 'private audit access leaked';end if;
end;$$;
select 'All ledger reconciliation assertions passed' as result;
