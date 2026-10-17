# Passive electricity API availability

Issue [#16](https://github.com/RA1NM4KER/newinmeter/issues/16) needs API visibility evidence before any buffer or retry change. This instrumentation never makes a LiveMopay request, schedules work, or supplies input to the scheduler. Existing automatic and manual fetches supply all observations. The adaptive scheduler, minimum interval, ten-minute buffer, HTTP and publication retries, budgets, lifecycle exclusions and reconciliation rules are unchanged.

## What is recorded

`electricity_fetch_observations` is a service-only table with one immutable, idempotent row per capture. `connection_id` comes from the capture, not a client-provided JSON identity. Both foreign keys cascade on deletion. RLS is enabled; anon and authenticated have neither table access nor RPC execute privileges. There is no new browser API.

Eligible captures are real, warm, adaptive connections fetched through automatic or manual sync, including manual full sync. Restore and demo captures are excluded. `autoSyncEnabled` is recorded, so manual observations from opted-out connections can be excluded in the evaluation. HTTP failures with no completed ledger response do not prove absence. A successfully fetched response is useful evidence even if subsequent ingestion fails; the failure is finalized first, then a bounded best-effort write saves the response facts. Missing observations remain missing, never synthetic empty responses.

Each observation records:

- Client fetch start and finish, the requested ledger start date and a hashed account/company/property/endpoint scope. A reconnect or provider change cannot borrow another scope's history.
- Incoming electricity anchor, raw cadence forecast, buffered expected time, model target, actual connection due time, confidence, electricity empty streak, HTTP failure streak and policy version. Confidence is cadence support, not a probability of prediction success.
- Manual/automatic trigger and reconciliation flag as separate dimensions. Reconciliation is not mutually exclusive with prediction or retry. The incoming prediction/retry/fallback classification is explicitly inferred from the saved model when the prior decision is unavailable. The observed outgoing decision is also recorded without recomputing or changing its target. The evaluator uses a matching prior outgoing decision to resolve incoming classification where possible. HTTP retry and manual flags remain separate.
- An inventory of electricity publication timestamps and 128-bit SHA-256 fingerprints of charge label plus consumption period. The label and period are not stored. Amount, balance, consumption, tariff, email, address, meter identifiers and tokens are not stored. The fingerprint excludes money and source date, so a money-only correction is not new availability and a source-date change of the same identity can be flagged as ambiguous.
- Returned normalized electricity/water row counts, parser completeness, truncation, invalid source-date count and old-source exclusions. Returned water rows are not a count of new water updates.

Publication time is exclusively the API ledger `date`, carried as `source_ts`. It must be a valid timestamp with an explicit timezone. Dates are normalized to UTC at JavaScript millisecond precision. Neither consumption `period_dt` nor formatted `capture_dt` substitutes for it. Periods are used only transiently for fingerprints and to flag a recently posted historical backfill. Zero-consumption electricity is still a publication.

The inventory includes valid source dates from the last 48 hours relative to fetch start, capped at 256 distinct source/identity pairs. Older source rows are counted but excluded from the inventory. A newly returned old-source entry therefore does not become a fresh primary publication. A recent source date describing a period over 48 hours old is retained but flagged historical. Future-dated source facts are retained and flagged ineligible; omitting them could falsely turn a previously returned future date into an absence. Duplicate records collapse. Partial overlapping batches, source-date corrections, and disappearance/reappearance are flagged by the evaluator and excluded from primary tuning metrics.

## Facts and inferred windows

For each exact reported source timestamp, evaluation retains the earliest **retained** response that contains it. This is an upper bound on visibility, not its exact onset or necessarily its first-ever appearance. Extra batch members found later are not a new publication at the same source timestamp, and the entire batch is not assumed visible at first-member discovery.

The lower bound uses the latest retained, non-overlapping earlier response that:

1. Has the same upstream scope and exact ledger start date. A broad reconciliation response does not automatically prove what a differently filtered incremental response would contain, or vice versa.
2. Fully parsed, did not truncate the inventory and had no invalid electricity source dates.
3. Covered the candidate source timestamp inside its tracked source-date range and did not return that timestamp.

The actual server snapshot instant is unknown. Therefore absence uses the earlier request **start**, and presence uses the later response **finish**, including parsing overhead. `notAvailableAfter` and `firstFoundAt` are conservative bounds, not observed server timestamps. Fetch IDs retain the actual observations for inspection. If an applicable negative does not exist, `notAvailableAfter`, interval width and lag lower bound are null. Source time is never substituted as a lower bound. Negative source-relative lower bounds are preserved, not clipped into a fictitious positive availability delay.

An inferred onset interval assumes comparable complete endpoint snapshots and no unobserved withdrawal/reappearance between them. The recorded facts themselves are only response presence/absence. Known reappearances and corrections invalidate primary onset interpretation. There is no proof of arbitrary provider snapshot completeness, publication immutability or hidden record withdrawals. Do not present interval midpoints as measurements or equate source-time prediction error with publication-to-ingestion delay.

## Storage, retention and cost

Successful captures reuse the existing capture-metadata round trip through `record_capture_metadata`, preserving the same metadata update and adding one compact observation insert. There is no per-publication database request. The diagnostic insert/prune has its own exception boundary and a non-waiting advisory lock; a diagnostic error or contention returns false and logs `newinmeter_availability_not_recorded`, without rolling back metadata or failing ingestion. Normal metadata-update failures retain the existing sync failure behavior. A failed ingestion can add one best-effort database request after finalization, capped at one second. No new upstream calls result.

There is a hard ingestion-path cap of 1,024 rows per connection and 64 KiB JSON per row, with at most 256 inventory entries. This bounds diagnostic JSON to 64 MiB per connection before indexes/row overhead; normal payloads are much smaller. New observations opportunistically delete up to 128 globally expired rows and cap their connection. The existing daily cold-storage invocation prunes all observations older than 30 days, even with no fetches or cold accounts. Thus normal TTL is 30 days plus daily maintenance resolution; scheduler outages can extend TTL and are visible in maintenance response/logs. A failed prune is reported as `availabilityObservationsPruned: null` and `newinmeter_availability_retention_failed`; it does not change cold-storage lifecycle behavior. No cron was added or rescheduled.

A local benchmark of minimized real 90-day ledger histories, 8,518 to 11,480 rows per response, produced 0 to 98 inventory items, approximately 0.8 to 13.1 KiB JSON before outgoing context, and median 0.81 to 1.32 milliseconds building each observation. These are local measurements, not production billing. Typical incremental payloads contain fewer rows. Monitor actual `pg_column_size`, insert duration and database size. Added storage and database work are nonzero; no paid infrastructure was added, and exact dollar impact depends on usage and plan allowances. There is a maintenance burden: future policy or parser changes must update/version the diagnostic schema and interpretation alongside their tests.

## Retrieval

Use the operator's service-role environment, never a browser or public dashboard. Export into an ignored private directory. The exporter is read-only Supabase access; it never contacts LiveMopay. Credentials and original connection/run IDs are not written into its output. Timestamps and hashed identities still warrant private handling.

```sh
NODE_OPTIONS=--dns-result-order=ipv4first node_modules/.bin/tsx \
  --conditions=react-server --env-file=.env.local \
  scripts/evaluate-electricity-availability.ts \
  2026-10-17T00:00:00Z 2026-10-31T00:00:00Z \
  .secrets/audits/electricity-availability-20261031
```

Choose the actual production instrumentation start after deployment verification, then 14 complete days. Include a preceding day if available to reduce left censoring, and analyze the intended 14-day cohort separately. `availability.json` contains aliased connections/fetches/scopes, response inventories, per-publication availability bounds, classifications, anomalies and descriptive summaries. Scope aliases permit deduplicating shared upstream accounts. The exporter itself does not select or deploy a scheduling policy.

Read-only production coverage check:

```sql
select c.trigger, c.status, count(*) as eligible_captures,
       count(o.run_id) as measured_responses
from capture_runs c
join livemopay_connections l on l.id = c.connection_id
left join electricity_fetch_observations o on o.run_id = c.id
where c.started_at >= :instrumentation_start
  and l.sync_schedule_mode = 'adaptive' and not l.is_demo
  and c.trigger in ('auto', 'manual')
group by c.trigger, c.status;

select count(*) as observations,
       min(observed_at) as first_observation, max(observed_at) as last_observation,
       sum(pg_column_size(observation)) as stored_json_bytes,
       count(*) filter (where observation->>'parserComplete' = 'false') as parse_incomplete,
       count(*) filter (where observation->>'truncated' = 'true') as truncated
from electricity_fetch_observations;
```

The coverage query uses current connection policy, not a historical lifecycle snapshot. Completed ledger responses that failed before observation persistence can be absent. Capture status alone cannot distinguish an HTTP failure from post-fetch ingestion failure; inspect stage diagnostics without exposing payloads. An initial response is a left-censored inventory baseline, not a burst of measured fresh publications. Large old-record first sightings should not dominate prediction scores.

## Evaluation after 14 days

1. **Timestamp-to-API visibility:** report source-relative lower and upper bounds separately, with upper-only and anomalous counts. Use an interval-censored analysis if enough narrow windows exist. A median of first-found lags is an upper-bound distribution, not a measured median availability lag.
2. **Window width:** report median/P90/worst width and the fraction lacking a negative bound, by independent source and cadence. Separate manual, reconciliation and automatic observations, parser gaps and truncation. Broad windows may remain insufficient despite 14 days.
3. **Premature fetching:** separate first-retained baselines, no new electricity publication, no returned electricity, water-returning fetches, genuinely post-target prediction misses, fixed fallback and HTTP failure. Pair a miss to the following discovered source stamp only with identifiable evidence. A zero-new-electricity fetch is not necessarily useless: water, corrections and daily reconciliation still matter. Explicitly distinguish cases where reported source time is before versus after the empty request. Do not claim five extra buffer minutes would succeed unless compatible visibility bounds support that counterfactual.
4. **Retry waiting:** use outgoing observed publication-retry decisions, actual next fetch times, source timestamps and visibility bounds. Without an intervening positive observation, useful-data waiting often remains bounded between zero and most of the retry gap. Report this uncertainty rather than claiming an hour of available data waited.
5. **Alternative policies:** preregister candidates and chronological learning/test windows before looking at new holdout outcomes. Replay candidate visibility assignments spanning all measured intervals, including missing/upper-only observations, at the same actual budgets, lifecycle rules, five-minute resolution, failure calendar and 90-day reconciliation. Compare median/P90/tails, empty electricity polls, water freshness, attempts, response bytes/rows and missed cycles. Do not extrapolate to a 71-minute regime without real observations. Shared-account connections are not independent replication. Changing production scheduling remains a separate decision.

Issue #16 requires at least 14 days and 100 publication batches per independent fast source, including stable and delayed behavior. If passive observations are too sparse to identify a meaningful equal-cost gain, retain the scheduler and report the uncertainty. This implementation does not promise passive observation can locate exact API onset or identify a unique optimum.

## Verification and rollback

Run `npm test`, `npx tsc --noEmit -p .`, and `npm run lint`. Targeted tests cover successful discoveries, electricity misses, water-only responses, zero consumption, historical periods, missing timestamps, mismatched scopes, incomplete/truncated responses, overlapping fetches/batches, duplicate entries, corrections, reappearance, insufficient observations and schedule contexts. `scripts/verify-electricity-availability.sql` verifies the migration in a disposable local PostgreSQL database named `newinmeter_availability_test`, including service-only permissions, idempotence, fail-open oversized payloads, retention, cap and deletion cascade. Never run that fixture against production.

Apply the additive migration before deploying code. After deployment, wait for natural existing captures; verify the observation/capture join, parser completeness, bounded size, scope isolation and prediction targets, plus unchanged cron schedules and scheduler settings. Do not invoke sync to generate a measurement. Verify actual negatives/discoveries only when existing traffic supplies them; tests do not substitute for this check. Daily retention execution can be verified through the existing maintenance response; the 30-day expiry itself is covered by local aged fixtures until real data ages.

Rollback code to the prior production commit. The additive table/functions can remain for their bounded retention window, with service-only access; no cursor, reporting model, reading, history or scheduling target needs resetting. Observation data can be archived privately before a separately reviewed drop. Reverting the collector removes all extra per-capture work. The old metadata PATCH and scheduling code remain compatible with the additive migration.
