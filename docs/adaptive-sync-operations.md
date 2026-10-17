# Adaptive LiveMopay sync

Issue: https://github.com/RA1NM4KER/newinmeter/issues/7

## Behaviour

Supabase pg_cron still ticks every five minutes. On alternate ticks the database skips the worker HTTP call unless an eligible connection is due. A ten-minute maintenance wake-up preserves abandoned-run recovery and remains below the existing fifteen-minute heartbeat warning threshold. This reduces idle worker invocations from 8,640 to 4,320 in a thirty-day month; due work can add intervening calls. Atomic claims, bounded concurrency, authentication, inactivity exclusions, cold storage, and manual refresh remain in place.

Each successful fetch learns electricity and water publication timing independently from actual source timestamps, including zero consumption. A compact versioned model retains at most twelve publication clusters per stream from the last seven days. Three agreeing recent gaps are required before selecting approximately 71-minute or 106-minute reporting. Six-hour batches and insufficient evidence use the existing four daily windows. The model is deterministic and uses no AI calls.

Only electricity drives adaptive polling. Water is still fetched and its publication observations remain available for diagnostics, but water predictions and missed water batches cannot schedule a fetch. Predictions include a ten-minute publication buffer and a one-hour minimum between ordinary adaptive fetches. A missed electricity prediction backs off. Repeated worker failures back off from thirty minutes to a maximum six hours. The database enforces a rolling twenty-four-hour automatic-fetch budget, default 24 and configurable between 4 and 24, including failed attempts. Manual refresh is outside that budget. A successful manual fetch also updates the next adaptive prediction when automatic sync is enabled, avoiding a redundant scheduled fetch shortly after manual refresh. A saturated account is deferred until its oldest counted attempt expires.

`sync_schedule_mode = 'shadow'` is the default. Predictions and metrics are recorded, but actual scheduling remains the four fixed windows. Only an explicit operator change to `adaptive` applies predictions. Existing lifecycle exclusions still apply in either mode. Active use and enabled alerts already determine inactivity eligibility; there is no new paid scheduler or separate account tier.

Adaptive accounts re-read ninety days once daily. Other incremental fetches retain the existing date-based cursor; the upstream ledger may return newly posted records describing older periods. Manual full sync remains available for older historical corrections. The daily lookback is a bounded reconciliation policy, not a guarantee that arbitrarily old upstream corrections are automatically discovered.

## Ingestion and observability

`upsert_changed_energy_rows` compares content in Postgres and only writes new/changed records. Unchanged rows retain their previous run and last-seen timestamps; last-seen now means last content write, not last successful fetch. Capture-run completion skips rollup refresh when no content or refund cleanup changed. A separate lightweight trigger still updates the dashboard successful-check timestamp and run metadata. Existing legacy ingestion with NULL `rows_changed` keeps its refresh behaviour.

Retries after lost HTTP responses count writes already owned by the current run. Records owned by an interrupted or failed run are picked up again so their affected dates receive a successful rollup refresh. Refund cleanup forces associated fetched records into the current run to preserve affected-date refreshes. Confidently identified balance/cost corrections replace superseded ledger keys rather than duplicating usage. The entire incoming response must contain only one variant of the event. Exact source timestamp, label, and period identify ordinary events; source-less legacy matches additionally require identical capture time and usage/tariff, with cost and balance differing by at most one cent. Conflicting incoming variants are retained rather than guessed away. Superseded rows are preserved in a service-only, RLS-protected `ledger_reconciliation_audit` table; it cascades on account deletion. Audit storage and legacy identity matching are additional maintenance considerations.

Capture runs record `rows_fetched`, `rows_changed`, `upstream_latest_at`, `predicted_next_at`, and existing timestamps for duration. `rows_synced` now counts rows written rather than every row submitted. Admin diagnostics show shadow/adaptive mode, prediction reason, confidence, latest upstream publication, next predicted fetch, and fetched/changed counts separately from the last successful check.

## Worker execution budgets

The worker's Vercel ceiling is 120 seconds, within the existing pg_net 120-second request timeout. It claims at most four accounts per invocation, matching its concurrency of four: one wave of work, with further due accounts picked up on later five-minute ticks. The request-local invocation budget is 110 seconds, automatic sync work is limited to 90 seconds, and individual LiveMopay/Supabase requests are limited to 20 seconds. Push delivery uses the remaining request budget as its native HTTP timeout. Nested budgets cannot exceed the invocation deadline and are isolated between concurrent requests/accounts using AsyncLocalStorage.

An automatic work deadline leaves the parent budget available for up to ten seconds of failure finalization. Requests are cancelled through AbortSignal rather than abandoned using Promise.race. A cancelled database request may nevertheless commit; existing idempotent upserts, finalization reconciliation and terminal-status guards remain essential. Only fully completed reconciliation advances last_reconciled_at. If cleanup cannot be confirmed, the existing fifteen-minute stale-run recovery still applies; the ten-minute claim lease, rolling daily fetch cap, inactivity/cold exclusions, and electricity scheduling rules remain unchanged. Manual/full/restore work retains its previous execution policy outside the cron budget.

`newinmeter_sync_stage` logs stage start/finish/failure and elapsed milliseconds; `newinmeter_sync_batch` adds batch progress for ingestion. They include connection/run identifiers and counts, never tokens, ledger payloads, upstream identities or request URLs. These timings distinguish session refresh, ledger fetch, batch ingestion, metadata persistence and finalization delays. The October 14 interruption was confirmed by a platform 60-second timeout; the exact stalled request was not logged. Automatic recovery later completed the 8,915-row reconciliation in about 28 seconds, so historical volume alone is not proof of the original stall's cause.

Scheduler setup and heartbeat reads/upserts share the pipeline's three-attempt transient retry policy within the same invocation budget. Claim acquisition remains single-attempt because a lost response may already have claimed a wave. Setup exhaustion returns 503 with the failed stage; successful responses include `heartbeatRecorded`. Optional diagnostic event failures cannot invalidate a persisted heartbeat. Lost recovery responses can undercount that invocation's recovered-run total, so capture state remains authoritative. Successful requests add no database operations; a transient failure can add two requests and 750 ms of backoff per safe operation, potentially deferring work within the existing deadline. The 17 October production check returned HTTP 200 with heartbeat persistence confirmed. Residual platform-error causality remains tracked in issue #15; reconciliation efficiency is a separate measured project in issue #14. No lookback or budget was reduced.

## Release and rollback

Apply `20261013083319_adaptive_meter_sync.sql`, `20261013083651_successful_empty_sync_summary.sql`, and `20261013085305_reconcile_corrected_ledger_keys.sql` before deploying the new worker and diagnostics select. The migration is additive and defaults all accounts to shadow mode. The old worker remains compatible during the transition.

Enable a pilot using a confirmed connection ID, not an account label that might be shared by multiple users:

```sql
update public.livemopay_connections
set sync_schedule_mode = 'adaptive'
where id = '<confirmed pilot connection uuid>';
```

After a successful shadow fetch has populated the model, an operator can rearm the pilot's first automatic run by setting `next_sync_at = now()` for that confirmed ID. This is a controlled activation, not a replacement for the scheduler's claim and budget checks.

Return an account to shadow mode and the next fixed window using the application scheduler, or set `next_sync_at = now()` to let the worker fetch once and resume fixed scheduling. Reverting the application while leaving the additive migration in place is also compatible. Do not drop columns while a new worker or diagnostics page is still deployed.

Before expanding, compare observed empty-fetch rate, automatic fetch count, per-run duration, payload/row volume, changed rows, and publication-to-ingestion delay against the baseline. Stream phase differences can increase work substantially. A zero new subscription cost does not imply zero resource cost.

## Verification

Unit tests cover zero usage, repeated evidence, separate stream phases, history bounds, invalid state, upgrades, return to legacy batching, missed predictions, historical reconciliation, worker prediction use, and repeated failure backoff. Full tests, typecheck, lint, and production build are required.

The SQL contract suite uses an isolated minimal Postgres fixture with a refresh counter and a fake HTTP function. It verifies new/unchanged/corrected writes, lost-response retries, failed-run recovery, refund refreshes, budgets, lease exclusion, lifecycle exclusions, privileges, and conditional worker wake-ups. It does not replace production rollup verification.

```sh
initdb -D <new disposable cluster directory> -A trust --no-locale
pg_ctl -D <cluster directory> -l <log path> -o '-p <unused port> -k <socket directory>' start
psql -h <socket directory> -p <port> -d postgres -v ON_ERROR_STOP=1 \
  -f test/sql/adaptive-sync-fixture.sql \
  -f supabase/migrations/20261013083319_adaptive_meter_sync.sql \
  -f supabase/migrations/20261013083651_successful_empty_sync_summary.sql \
  -f test/sql/adaptive-sync-assertions.sql \
  -f supabase/migrations/20261013085305_reconcile_corrected_ledger_keys.sql \
  -f test/sql/ledger-reconciliation-assertions.sql
```

Offline replay consumes a private JSON audit file shaped as an array of `{ account, label, rows }`, where rows are normalized LiveMopay CSV records:

```sh
npx tsx --conditions=react-server scripts/replay-reporting-schedule.ts \
  <private-ledger.json> <start ISO timestamp> <end ISO timestamp>
```

Replay assumes hypothetical eligible accounts, starts without persisted observations, applies a rolling 24-fetch budget, and rounds fetches to five-minute ticks. It estimates publication delay and polling; it does not simulate HTTP failures, worker capacity contention, billing, or production lifecycle eligibility.

## Pre-release evidence, 13 October 2026

The production baseline for 6 through 12 October was 323 successful automatic runs, averaging 2.31 seconds and submitting 29,349 rows. Those old row counts include duplicate submissions, so they cannot be compared directly with new changed-row counts.

Replay over 6 October 00:00 UTC through 13 October 06:00 UTC compared thirty fixed-window fetches per account with bounded adaptive fetches. Illustrative results:

| Reporting behaviour                     | Adaptive fetches | Mean publication delay, fixed | Mean delay, adaptive |
| --------------------------------------- | ---------------: | ----------------------------: | -------------------: |
| Stable 106-minute account               |              167 |                   181 minutes |           30 minutes |
| Another stable 106-minute account       |              156 |                   180 minutes |           27 minutes |
| 71-minute account                       |              170 |                   182 minutes |           27 minutes |
| Legacy electricity with no water stream |               30 |                   208 minutes |          208 minutes |
| Irregular electricity-only account      |               64 |                   188 minutes |          146 minutes |

The irregular account had 24 empty adaptive fetches, so a broad rollout there is not justified by this replay. These historical replay results used the earlier combined electricity/water scheduling policy. Under the current electricity-only policy, a faster water cadence cannot increase polling; legacy electricity uses the four-window fallback.

Vercel usage inspection returned `Costs not found (404)`. No claim of measured bill savings or unchanged billing has been made. There are no additional service subscriptions. Daily reconciliation adds a larger fetch and comparison once per adaptive account per day; model and metrics persistence add database operations to each successful run. These are the principal new resource and maintenance costs.

## Live ingestion verification

Before application release, the new pipeline fetched 48 records for the pilot account and wrote 18 changed records. The immediate repeat fetched the same 48 and wrote zero. The changed run's database duration was approximately 2.78 seconds; the unchanged repeat was approximately 1.95 seconds. These small samples establish correct no-op behaviour, not a billing forecast. Electricity and water daily totals matched raw records. After the empty-summary migration, another zero-change fetch updated the dashboard successful-check timestamp to the latest successful capture run while leaving the consumption rollups intact.

The first natural automatic pilot ran at 10:45 SAST, fetched 8,884 records for daily reconciliation, and completed in 17.65 seconds. It also revealed old one-cent ledger-key variations that would have duplicated usage under the prior balance-based key. The correction migration was verified against the live account: 75 superseded entries were archived privately and replaced, and no duplicate identified events remained in the reconciliation window. Ordinary incremental checks and full daily reconciliation have materially different payloads and durations; use separate cohorts when measuring resource changes.

A repeated live reconciliation fetched the same 8,884 records and wrote zero, completing in 12.56 seconds end to end. This establishes idempotency after the historical correction repair, and demonstrates why daily reconciliation should be measured separately from ordinary incremental checks. The audit table retained 75 superseded entries.
