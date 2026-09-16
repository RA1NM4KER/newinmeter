-- Storage relief for the Free-plan database limit.
--
-- Both single-column indexes are unused in pg_stat_user_indexes on the live
-- project. The application sorts within a connection and uses its
-- connection-scoped indexes instead, so these global indexes only duplicate
-- storage and write work. Dropping indexes never deletes ledger data.

drop index if exists public.energy_rows_usage_qty_idx;
drop index if exists public.energy_rows_capture_ts_idx;
