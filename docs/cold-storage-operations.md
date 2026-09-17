# Inactive-user cold storage

Cold storage starts after **45 days of genuine foreground inactivity**. The source of truth is
`user_activity_days.last_seen_at`. Only when a user has no foreground row does eligibility conservatively fall back to
the later of `auth.users.last_sign_in_at` and the connection's `connected_at`.

There is a separate, earlier intervention for the same underlying problem (an inactive account still growing the
database): **auto-sync inactivity pause** stops scheduling new background syncs after just **14 days** of the same
inactivity signal, with the same alerts exemption, but purges nothing and never touches `data_state`. It exists because
cold storage's 45-day threshold is deliberately conservative (a real purge needs a long runway before acting), which
otherwise leaves a 31-day gap where an obviously-abandoned account keeps accumulating `energy_rows`/rollup data for no
one to ever look at. See "Auto-sync inactivity pause" in `MULTI_USER_SETUP.md` (section 21) for the mechanism
(`auto_sync_is_paused_for_inactivity`, a live-computed predicate, not a stored flag) and how resuming works without a
restore step, since nothing here is purged.

## Safety and exclusions

The service-role-only candidate/claim function excludes demo accounts, admins, `engagement_excluded` users, enabled
connection or rule alerts, enabled live meter devices, scheduler claims, and running capture runs. Claiming changes the
connection to `hibernating`; the row-locked `start_capture_run` RPC then prevents a new normal sync from starting. A
worker crash leaves the connection resumable after the claim lease instead of making a partially purged connection warm.

Only these reproducible tables are purged, in bounded connection-scoped batches:

- `energy_rows`
- `energy_hourly_rollups`
- `energy_interval_rollups`

Daily rollups, `dashboard_summary`, `usage_activities`, alert settings/events, user roles/preferences, Auth users,
connection metadata, encrypted refresh tokens, and meter hardware/telemetry are preserved. The row becomes `cold` only
after all three approved tables are empty for that connection.

The scheduled endpoint is `GET /api/cron/cold-storage` at 04:15 UTC daily, authenticated with `CRON_SECRET`. It claims at
most two connections and works for at most 45 seconds. Inspect `data_state`, lifecycle timestamps/errors, and the three
`cold_*_deleted` counters on `livemopay_connections`; the endpoint also returns and logs per-run counts. Before enabling
the schedule, operators can call the service-role-only `list_cold_storage_candidates('45 days', 100)` RPC as a dry-run
preview. Never grant lifecycle claim/purge/finalize RPCs to `anon` or `authenticated`.

## Return and recovery

The app layout sends cold/restoring/failed users to `/restore`. An owner-scoped RPC atomically changes `cold` (or a
retryable `restore_failed`) to `restoring`; repeated browser requests receive `should_start=false`. Restoration uses the
existing capture-run concurrency guard and an explicit `restore` sync mode whose start date is 90 days ago. No database
lock is held during LiveMopay HTTP calls. On success the connection becomes `warm`; an invalid refresh token becomes
`restore_failed` and requires reconnecting. The five-minute auto-sync worker marks abandoned restorations retryable after
30 minutes when no capture run is active.

## Space maintenance

Batched `DELETE` makes table pages reusable by PostgreSQL but does **not** guarantee that `pg_database_size` shrinks.
Autovacuum should reclaim dead tuples for reuse; monitor `pg_stat_user_tables`, dead tuples, free-plan database size, and
query performance after a run. If physical file compaction is still required, schedule a separately reviewed maintenance
window with a backup and enough temporary disk headroom. Use a supported online-rewrite approach where available, or
`VACUUM FULL` only with explicit downtime planning because it takes an exclusive table lock and can need substantial
temporary space. This feature never runs `VACUUM FULL`, `CLUSTER`, table rewrites, or production maintenance automatically.
