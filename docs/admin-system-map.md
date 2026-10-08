# Admin System Map

`/admin/system` is the operational architecture view, under **Admin → System**.
It complements `/admin/diagnostics`: choose a component or connection for evidence,
metrics and diagnostic links. Desktop offers a diagram and a list; phones use the
same inspectable component list with an expandable connection list.

## Topology and source evidence

The typed model in `src/lib/system-map/topology.ts` owns component identities,
relationships, telemetry adapter keys, diagram geometry and possible-impact paths.
React renders that model. Adding a component does not require inventing a new
health check: use `unknown` until real evidence exists.

| Runtime relationship | Repository evidence |
| --- | --- |
| LiveMopay ledger and Firebase session → sync | `src/lib/newinmeter/sync.ts`, `src/lib/newinmeter/web.ts` |
| pg_cron/pg_net → scheduled sync worker | `supabase/migrations/20260824000000_newinmeter_auto_sync_schedule.sql`, `src/app/api/cron/auto-sync/route.ts` |
| Sync → Postgres records and capture finalization | `src/lib/newinmeter/sync.ts` |
| Capture finalization → synchronous rollup trigger | `supabase/migrations/20260726030000_livenopay_finish_capture_run_rpc.sql`, `supabase/migrations/20260725040000_livenopay_capture_run_trigger_fix.sql` |
| Derived data → post-sync alert evaluation | `src/app/api/sync/route.ts`, `src/app/api/cron/auto-sync/route.ts`, `src/lib/newinmeter/alerts.ts` |
| Vercel stale-check → delayed-data alerts | `vercel.json`, `src/app/api/cron/stale-check/route.ts` |
| Alert evaluation → Web Push → service worker | `src/lib/newinmeter/alerts.ts`, `src/lib/push-notify.ts`, `public/sw.js` |
| Stored data → authenticated app reads | `src/app/api/daily-rollups/route.ts`, `src/lib/auth/session.ts` |
| App sessions → authorized client APIs | `src/lib/auth/session.ts`, `src/lib/supabase/server-client.ts` |
| PWA → AI assistant → scoped database tools | `src/app/api/assistant/route.ts`, `src/lib/assistant/` |

The provider's Firebase session is separate from Supabase app authentication.
The pg_cron auto-sync heartbeat is not evidence that Vercel maintenance jobs ran.
The map is a code-defined operational model, not automatic infrastructure discovery.
Update it when runtime dependencies change. Model tests check identities, edge
endpoints and resolver coverage, but cannot prove a newly added runtime service is
represented without someone updating this definition.

## Health semantics

`src/lib/system-map/resolve.ts` adapts existing diagnostics to a narrow map DTO.

- **Healthy:** the particular described observation passed, not a universal service guarantee.
- **Degraded:** a recorded warning or one or more affected connections/alert families.
- **Failed:** a current contract failure, overdue scheduler heartbeat, or explicit critical incident.
- **Unknown:** missing, stale or unavailable evidence. No events is not proof of health.
- **Affected:** possible impact along an explicitly modeled dependency. It is not a causal diagnosis.

A missing scheduler heartbeat is Unknown. An existing overdue heartbeat retains
Diagnostics' 15/30-minute warning/failure thresholds. The provider canary retains
Diagnostics' classifications, but missing checks or checks older than 48 hours are
Unknown. Push outcomes older than 24 hours are Unknown unless unresolved incidents
remain; push is event-driven and silence is not itself failure.

Sync health summarizes current connection health; it does not claim that every
connection failure is a worker outage. Recent successful captures, within eight
hours, provide indirect evidence of rollup completion. A successful diagnostics
read proves only that database read path. App auth and browser clients lack probes and display as Not monitored. The provider session has no probe of its own: it is inferred Healthy from a successful sync (within eight hours) or a passing daily canary (within 48 hours), both of which require a working token refresh, and is otherwise Unknown. It is never marked Failed because a failure cannot be attributed to the session alone. Maintenance, alerts and AI use the passive observations described below.

When LiveMopay or the scheduler fails, sync and ingestion can be Affected without
marking the database itself down. Independent measured failures retain their own
status. Possible impact is shown separately in the inspector; existing connection
symptoms are retained. Recovery recomputes impact from the new snapshot.

Capture durations and row counts are labeled as whole-pipeline sampled metrics,
never endpoint latency or a throughput rate. The existing diagnostics sample is
bounded to 500 recent captures globally and eight per current connection; totals
are sample totals, not historical totals. Failure timestamps come from recorded
runs/incidents, so missing timestamps do not imply no failure ever occurred.

All unresolved events are included in health evaluation even if they fall outside
the 40-event recent window. The inspector shows up to six relevant events, prioritizing unresolved failures.
No independently unmeasured connection is colored healthy solely because its
source or destination is healthy. Push-service acceptance is not a browser receipt.

## Polling and failures

The page revalidates on mount, polls every 45 seconds while visible, and refreshes
on returning to the tab. Requests do not overlap and time out after 15 seconds.
A failed refresh keeps the last evidence for inspection but marks displayed current
health Unknown. Snapshots older than two minutes are likewise stale. Recovery
restores measured statuses. HTTP 429 respects `Retry-After`; 401/403 removes the
snapshot and stops automatic reads. Unmount aborts outstanding requests.

The UI has no packet animation or simulated activity. The refresh spinner indicates
an actual request. Graph buttons and edges are keyboard accessible; the shared
inspection dialog traps focus, closes with Escape, and restores the opener's focus.

## Access, cost and deployment

Both the page and `/api/admin/system` enforce `requireAdminSession`. The endpoint
uses a dedicated `systemMap` rate limit of 10 requests/minute and 5,000/day per admin,
with `Cache-Control: private, no-store`. It returns generic backend failures rather
than query/exception details. The client validates complete snapshots with Zod,
including Postgres timestamps with UTC offsets.

The server reuses the Diagnostics read batch, plus two additional reads for health
state timestamps and unresolved events. The admin layout's Diagnostics read is
request-deduplicated with the page by React cache. Polling cost scales with visible
admin tabs and with the existing Diagnostics connection/auth-user queries; map polling adds
no traffic on normal user pages. Passive writes during real work are described below. At 45 seconds, one
continuously visible tab makes roughly 80 refresh requests/hour plus arrival and
visibility revalidations. Future fleet growth may justify a purpose-built aggregate
query or short server cache with explicit freshness semantics.

No new database tables, migrations, credentials, provider probes or scheduler
changes are required. Passive completion writes are described below. Raw state metadata, user emails, account labels and connection
records are not sent to the map. Event messages are sanitized at serialization.

Validation covers health/impact logic, stale evidence, event recovery, DTO safety,
authorization, rate limits, polling lifecycle and component/connection inspection.
Browser review uses the actual React components and generated app CSS with fixture
telemetry in light/dark desktop and mobile layouts. This does not substitute for a
production admin session or an end-to-end test against live telemetry.

## Passive telemetry and cost controls

The map also reads completion evidence for the three existing Vercel daily jobs,
post-sync and delayed-data alert evaluations, and accepted assistant requests.
No synthetic AI requests, additional scheduled jobs, new provider probes or new
paid services are introduced. No schema migration is needed.

`src/lib/diagnostics/passive-health.ts` overwrites separate success/failure rows
in the existing `system_health_state` table. The demo reset also has an explicit
skipped outcome. These instrumented paths use at most 13 rows, not a growing
per-request history. Each recorded outcome uses one small upsert without a
pre-read; it does not create a new `system_events` entry. Existing alert incident
reporting continues unchanged.

Alert and assistant outcomes are sampled at most once per component/outcome per
ten minutes **per warm server instance**. This also backs off failed telemetry
writes. Cold starts and concurrent instances can each write a sample, so this is
not a global quota. With traffic, a warm instance can write at most six samples
per outcome per hour; low traffic typically records the first real operation.
The three daily jobs record one outcome per invocation, normally three writes/day.
Additional operator invocations also record outcomes. Idle services perform no
extra work. The map reads these rows in its existing health-state query.

Telemetry requests have a 1.5-second abort deadline and failures are swallowed.
A sampled alert/job completion can wait up to that deadline; the assistant sends
its response/error event before awaiting telemetry, then closes its stream. This
adds a small database and function-duration cost, not extra model usage. Actual
billing depends on traffic, server instances and the existing hosting plan.

Maintenance is Healthy after a completed invocation, including a valid no-work
run; partial cold-storage failures count as Failed even when the route returns
HTTP 200. Missing completion after 26 hours is Degraded and after 48 hours Failed.
No heartbeat before the first instrumented invocation remains Unknown. A recently
skipped demo reset stays Unknown and explains its missing configuration. Abruptly
terminated jobs cannot write their outcome; their missing completion is detected
on a subsequent map read, with no extra watchdog job or automatic push introduced.
The stale-check edge uses its own job outcome, so a cold-storage or demo-reset
failure does not imply the alert-evaluation path failed.

Alert success requires an enabled-rule evaluation; a disabled feature or empty
rule set does not produce a success. Unresolved existing incidents remain
authoritative, even if another account's evaluation succeeded. Assistant telemetry
starts only after auth, feature access, rate limiting and request validation. Client
cancellation is excluded. Durations include application/tool work, not just model
latency. Neither feature claims an exact request count, error rate or percentile
from sampled latest-outcome rows. A sampled failure remains Degraded for at least
30 minutes even if followed by success; observations older than 24 hours become
Unknown because inactivity is not failure.

Only component, outcome, timestamp, duration and an optional evaluated-rule count
are persisted. No prompts, responses, user IDs, emails, tokens or raw exceptions
are added to this telemetry. The map serializes only allowed numeric metrics from
state details. New evidence populates naturally after deployment and real activity.

The System loading state mirrors its status cards, component positions and
connections, with a corresponding mobile list. It appears during both route
loading and the initial client retry. Skeleton shimmer respects reduced motion.
