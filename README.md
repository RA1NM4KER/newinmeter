# NewinMeter

**Your usage. Finally clear.**

LiveMopay doesn't let you download your data. NewinMeter pulls your ledger history from
LiveMopay's web API, syncs it to Supabase, and gives you a proper dashboard: usage, spend,
balance, fixed charges, water, tariff changes, 30-minute interval breakdowns, and raw transaction
history.

Built for the Newinbosch community. NewinMeter is an independent project, not affiliated with
Newinbosch HOA, Livewire, or LiveMopay.

NewinMeter is a **multi-user MVP**. Each person signs up with Supabase Auth, connects their own
LiveMopay account with their own email and password, and sees only their own data. It is not a
finished, fully production-hardened product -- see "Known limitations" in `MULTI_USER_SETUP.md`.

It also includes an in-app energy copilot ("AI v2") that answers grounded questions about the
currently selected date range -- comparisons, top usage periods, top-up activity, spikes, balance
patterns, and (when Alerts is on) the account's alert state -- with structured evidence, a small
real-data chart, and, where relevant, a proposed next action (add an Activity, set an alert, sync)
that only runs after the user explicitly confirms it in the UI. See "Assistant" below. Assistant
access is a per-user permission an admin can revoke, and every assistant call and every confirmed
action is rate-limited server-side regardless of what the UI shows.

There's a lightweight admin/roles system on top of Supabase Auth (everyone is `role: 'user'` by
default; one seed admin is set in a migration), and every user can permanently delete their own
account and all their data from Settings, without contacting anyone.

There are two ways to run this:

1. **Hosted multi-user setup** -- deploy the Next.js app, each user signs up and connects their
   own LiveMopay account through the UI. See `MULTI_USER_SETUP.md`.
2. **Legacy personal local setup** -- a single-owner Python CLI that predates multi-user support.
   See "Legacy Local Setup" below.

## Architecture

```
Supabase Auth sign-in
  -> user_roles row lazily created (role: 'user' by default; one seed admin via migration)
  -> /connect: LiveMopay email + password -> Firebase auth -> account discovery
  -> encrypted refresh token stored in livemopay_connections
  -> /api/sync: server-side ledger fetch, normalized, upserted into Supabase (connection-scoped)
  -> Postgres trigger recomputes that connection's rollups + dashboard_summary row
  -> dashboard / data table / export / assistant read through Supabase RLS, scoped to auth.uid()
  -> every authenticated API route checks a per-user Upstash rate limit before doing any work

Supabase pg_cron (every 5 minutes)
  -> pg_net POST -> protected /api/cron/auto-sync (server-to-server, bearer-secret auth)
  -> atomically claims a small batch of connections whose next_sync_at is due
  -> runs the same /api/sync pipeline (incremental) for each, bounded concurrency
  -> records outcome, computes each connection's next deterministic scheduled window
  -> on success, evaluates that connection's enabled alert_rules against fresh rollups
  -> a crossed threshold creates an alert_events row and sends a Web Push (deduped while active)
```

There is no generic job queue or remote command system -- automatic LiveMopay syncing is the one
narrow, purpose-built scheduler described above, not a distributed task framework. The deployed
app never depends on local files -- no CSV, no session file. See `MULTI_USER_SETUP.md` for the
full ownership model, migration order, setup steps, and the "Automatic sync scheduling" section
for how the scheduler itself is configured.

## Supabase Schema

Apply the migrations in `supabase/migrations` in timestamp order -- see `MULTI_USER_SETUP.md`
section 6 for the exact order and where the legacy-owner backfill fits in. The multi-user
migrations add:

- `livemopay_connections` -- one row per user's LiveMopay connection: discovered account/company/
  property ids, an encrypted refresh token (AES-256-GCM, nullable when disconnected), status,
  `is_demo` (marks the one seeded recruiter/demo connection -- see "Demo account" below), and the
  automatic-sync scheduling columns (`auto_sync_enabled`, `next_sync_at`, `last_auto_sync_at`,
  `last_auto_sync_status`, `sync_claimed_at`, `alerts_enabled`) -- see "Automatic sync scheduling"
  in `MULTI_USER_SETUP.md`.
- `connection_id` ownership on `energy_rows`, `capture_runs`, `energy_day_rollups`,
  `energy_hourly_rollups`, `energy_interval_rollups`, and `dashboard_summary` (one summary row per
  connection, replacing the old single global row). All of these cascade-delete when their
  `livemopay_connections` row is deleted, which is what powers self-service account deletion.
- Row Level Security on every one of those tables, scoped to the caller's own connection via a
  `SECURITY DEFINER` ownership function -- no anonymous read access to personal data.
- `user_roles` -- one row per user: `role` (`'admin' | 'user'`), `ai_assistant_enabled`, and
  `activities_enabled`. Read/written exclusively via the service-role REST helpers (same as
  `livemopay_connections`); authorization is enforced in code (`requireAdminSession` /
  `requireActivitiesSession`), not by RLS. Rows are created lazily on first authenticated
  request; the one seed admin is set by `20260726000000_newinmeter_user_roles.sql`.
- `usage_activities` -- user-created household context with half-open whole-day
  or 30-minute ranges, canonical reusable tags, optional notes, and connection-scoped
  CRUD RLS. Activity reports join these ranges to interval rollups; they never write
  into imported ledger or generated rollup tables.

The original single-user schema (`energy_rows` with the CSV-shaped columns, `capture_runs`,
rollup tables, the water-support columns) is unchanged in shape; multi-user support only adds
ownership on top of it.

## Quick Start (hosted multi-user)

See `MULTI_USER_SETUP.md` for the full walkthrough. Short version:

```
npm install
cp .env.example .env.local   # fill in the "Hosted multi-user configuration" section
npm run dev
```

Apply the Supabase migrations, open `http://localhost:3000`, sign up, connect a LiveMopay
account, sync.

You'll also need an Upstash Redis database (free tier) for rate limiting -- see "Rate limiting"
below. The app throws on the first API request without it; there's no in-memory fallback.

## Assistant

The assistant ("AI v2") is a grounded energy copilot for the active dashboard date range, scoped to
the signed-in user's own connection. It follows one shape on every turn: **data -> explanation ->
evidence -> action**. It only answers using the tool results below and never invents numbers,
dates, tariffs, balances, top-ups, alert state, or Activities, and never runs arbitrary SQL.

### Model / API

`src/lib/assistant/openai.ts` calls the OpenAI **Responses API** (`client.responses.create`, via
the official `openai` npm SDK) in a tool-calling loop, capped at 8 iterations. `OPENAI_MODEL`
(default `gpt-5.6-terra`) and `OPENAI_REASONING_EFFORT` (default `low`) are both env-overridable;
`reasoning.effort` is only sent for models the Responses API actually accepts it for (gpt-5+/
o-series -- verified live: it 400s for older models like gpt-4.1-mini, so
`modelSupportsReasoningEffort` skips it there rather than breaking every request). Reasoning
content is never requested via `include` and never appears in the response returned to the client.

### Structured response contract

The model must finish every turn by calling one more tool, `submit_response`, with a strict
JSON-Schema-validated payload (`src/lib/assistant/response-schema.ts`, cross-checked against its
own zod validator in a test) -- it never replies with free-form text as the real answer:

```ts
type AssistantResponse = {
  headline: string; // one short, concrete conclusion
  metrics: { label: string; value: string }[]; // 0-3 key numbers backing the headline
  body: { heading: string | null; text: string }[]; // 0-3 short explanatory blocks, no markdown
  evidence: AssistantEvidence[]; // day / period / activity / alert / data_status references
  visualizations: AssistantVisualization[]; // hourly_usage / daily_usage / period_comparison
  actions: AssistantAction[]; // navigate, or a proposed mutation (see below)
  suggestions: string[]; // 0-2 follow-up questions
  scope: { from: string; to: string };
};
```

The response is rendered as structured hierarchy (headline, then metrics, then body blocks, then
the chart, then actions), never as one prose paragraph -- see `src/components/assistant/
assistant-message.tsx`. The model chooses _which_ visualization and _what to highlight_; the
client resolves the actual numbers from the app's own existing endpoints (`/api/day-intervals`,
`/api/daily-rollups`) -- the model never supplies chart data itself. An `hourly_usage`
visualization carries a `highlights` **array** (each with an optional short `label`), not a single
window, so a day with two contributing periods (e.g. a morning peak and an evening peak) renders
as one chart with two highlighted ranges -- `normalizeVisualizations` (`response-schema.ts`) also
merges/dedupes same-date `hourly_usage` entries the model might otherwise emit separately, so the
UI never shows two near-identical full-day charts. If the model skips `submit_response` (plain
text) or its arguments fail validation (one retry, then give up), the server falls back to a
minimal, still-valid response rather than rendering raw model output.

Action buttons render the UI's own short canonical label per action type/shape (e.g. "View day"
vs "View data", "Set alert", "Turn off alert") -- never the model's own free-form `label` text,
which can be long enough to wrap badly on a narrow phone (see
`src/components/assistant/action-presentation.ts`).

### Read tools (registered per-request based on feature access)

1. `get_scope_overview` - totals, peaks, balance, and generated insights for the active range
2. `get_balance_runout` - estimate when the current balance runs out and whether it covers month-end
3. `compare_previous_period` - compare the active range to the immediately preceding range of equal length
4. `compare_calendar_months` - compare the latest calendar month in scope to the prior month and return month-by-month breakdowns
5. `get_top_days` - highest days by spend, usage, or average tariff
6. `get_top_hours` - highest hours by spend or usage
7. `explain_day` - explain a single day with daily rollups plus top half-hour intervals
8. `get_recent_topups` - list recent top-ups in the active range
9. `get_water_overview` - summarize water charges in the active range
10. `get_data_status` - sync freshness/completeness, incomplete days, suspected gaps
11. `get_activity_report` - **Activities only** - activities/tags with usage recorded during their windows (correlation, never causation)
12. `get_alert_status` - **Alerts only** - every alert type's enabled state, threshold, current metric, and dedup semantics (why an alert did/didn't fire again)
13. `get_recent_alerts` - **Alerts only** - recent alert events (mirrors the notification centre; suppressed/duplicate-pair events excluded)
14. `explain_alert` - **Alerts only** - full detail on one alert event by id, ownership-checked server-side; for a usage spike, includes surrounding hourly context and any overlapping Activity
15. `get_alert_recommendations` - **Alerts only** - grounded alert suggestions (only types with real supporting data, never every type by default)

### Actions -- never executed by the model

Every mutating action (`add_activity`, `set_alert`, `update_alert`, `disable_alert`, `sync`) is a
typed **proposal only** -- there is no tool the model can call to mutate anything. The UI renders a
proposal as a compact confirmation card (editable where it matters: tags for an Activity, threshold
for an alert); nothing happens until the user clicks Confirm. That POSTs to
`/api/assistant/actions`, which re-validates every argument with zod (never trusting the LLM's own
structured-output validation as the only check), resolves ownership from the authenticated
session, respects the same feature gates and demo-account restrictions as the rest of the app, and
calls the exact same domain functions the corresponding hand-built UI already uses
(`createActivity`, `upsertAlertRule`, `runLivemopaySync`) -- no duplicated business logic.
`navigate` actions run immediately client-side (`src/lib/assistant/navigation.ts` maps a typed
destination to one of the app's own routes/query params -- never an arbitrary URL).

### Alerts integration

"Ask AI" on a notification (bell icon) opens the assistant with the alert's id passed as **trusted
UI context** (`{ context: { alertEventId } }` on the request, not text baked into the question),
which the system prompt uses to call `explain_alert` first. Alert tools are registered only when
Alerts is enabled for the account, and reuse the evaluator's own semantics/copy
(`notifyCopyFor`, `event_context` snapshots) rather than re-deriving them, so the assistant's
explanation of dedup/hysteresis/correlated-suppression behavior can't drift from what actually
happened.

### Security

- Every tool and action resolves the caller from the authenticated session (`requireConnectedSession`) -- never a client-supplied user/connection id.
- Alert event ids and Activity ids are ownership-checked server-side before any read or write.
- Structured output is JSON-Schema-constrained (`strict: true` on every tool, including `submit_response`) and re-validated with zod before ever reaching the client.
- Feature gates (`ai`, `activities`, `alerts`) are checked server-side on every route, not just hidden in the UI -- revoking access takes effect immediately.
- The demo account's mutation actions don't render in the UI, and the actions route independently refuses them (`DemoAccountProtectedError` / a dedicated demo check for Activities and sync).

## Roles and Admin

Every signed-in user gets a `user_roles` row on first authenticated request (role `'user'`,
`ai_assistant_enabled: true`, `activities_enabled: false` by default). One seed admin is set in
`supabase/migrations/20260726000000_newinmeter_user_roles.sql`.

Admins get an "Admin" nav item (hidden entirely from non-admins; `/admin` 404s for them) with a
table of every user, where they can:

- Promote/demote between `admin` and `user` (an admin can't demote themselves, checked both in
  the UI and the API, so you can't lock yourself out)
- Toggle a user's access to the AI assistant
- Toggle a user's access to Activities

`requireAdminSession` (`src/lib/auth/session.ts`) is the shared guard -- every admin route/page
resolves the caller and checks their role from that one place, never trusting a role passed in
from the client.

`/admin/diagnostics` adds the admin-only operational view: overall health, the daily LiveMopay
contract canary, scheduler heartbeat, per-connection failure/staleness state, recent
`capture_runs`, push-subscription count, and a deduplicated system-event feed. It never selects or
serializes LiveMopay/Firebase credentials or upstream account/property/device identifiers. See
`docs/admin-diagnostics.md` for health rules and production setup.

Activities is opt-in (`activities_enabled` defaults to `false`) while the feature is being tested
with one user before a wider rollout. `requireActivitiesSession` wraps `requireConnectedSession`
with that permission check and guards every activity API route
(`/api/activities`, `/api/activity-report`, `/api/activity-export`); the UI (nav link, `/activities`
page, dashboard Day Detail) hides the same way `isAiAssistantEnabled` hides the assistant.

## Rate limiting

Every authenticated API route (`assistant`, `energy-rows`, `day-intervals`, `export`,
`livemopay/connect`) checks a per-user rate limit before doing any work, backed by Upstash Redis
(`src/lib/rate-limit.ts`) so the limit actually holds across serverless cold starts and instances
-- a plain in-memory counter doesn't survive that on Vercel. Identifiers are always the
authenticated user id, never IP, since every one of these routes is already authenticated by the
time rate limiting runs.

The assistant has its own tighter policy (5/minute, 30/day) since it's the one route that costs
real money per call; confirmed assistant actions (`/api/assistant/actions`) get a separate,
slightly looser policy (10/minute, 50/day) since a conversation confirming a couple of alerts
shouldn't eat into the question budget; everything else defaults to 60/minute, 1000/day.

Needs one of these env var pairs (see `.env.example`):

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` -- signing up directly at
  [upstash.com](https://upstash.com)
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` -- Vercel's Upstash Marketplace storage integration,
  which keeps the older Vercel KV variable names

## Account deletion

Users can permanently delete their own account from Settings (type `DELETE` to confirm):
`deleteAccountForUser` (`src/lib/newinmeter-connection.ts`) removes their `livemopay_connections`
row (cascading to every table keyed off it -- see "Supabase Schema" above) and deletes their
Supabase Auth user entirely. Fully self-service, no admin action required. The one exception is the
shared demo connection (`is_demo`), which refuses to delete itself -- see "Demo account" below.

## Demo account

A shared account anyone can explore with one click, plus a private link for job-application
reviewers -- both land on the same fully populated dashboard, analytics, Activities, and assistant.
No real LiveMopay account involved, no inbox access needed, and no change to how everyone else signs
in.

**Normal sign-in is untouched.** Every real account still only ever uses Google OAuth or Supabase
email OTP/magic-link (`signInWithOtp`) -- see `src/components/auth/login-form.tsx`. There is no
password field anywhere in the normal UI and no password is stored for normal accounts.

**The demo has two entry points into the same account, both through one endpoint:**

- **Public**: an **Explore demo** button on `/login` itself, visible to every visitor, no token or
  query param involved. This is the primary "try before you sign up" path.
- **Recruiter/private link**: `https://<your-domain>/login?demo=<NEWINMETER_DEMO_ACCESS_TOKEN>`, kept
  for sharing a link outside the normal login page. `src/app/login/page.tsx` validates the `demo`
  query param server-side via `isValidDemoAccessToken` (`src/lib/demo/access-token.ts`, SHA-256 +
  `timingSafeEqual`, so an invalid guess can't be timed to learn how close it was) _before rendering
  anything_; a missing or wrong token renders byte-identical to a plain `/login` visit as far as that
  param goes.

1. Clicking **Explore demo** `POST`s to `/api/demo-login` (`src/app/api/demo-login/route.ts`) with a
   `token` field when the page resolved one from the query param, or an empty body for the public
   button. Either way the route:
   - rate-limits by IP first (`demoLogin` policy, 5/minute, 30/day -- this is the endpoint an
     attacker would use to brute-force the token, or simply hammer the public path)
   - if a token was supplied, re-validates it server-side (never trusts the page's render decision);
     if none was supplied, treats the request as the public path and skips straight to the checks
     below -- the token was never what made this endpoint safe to expose, the fixed target account
     and the checks that follow are
   - looks up the **one** Supabase Auth user matching `NEWINMETER_DEMO_EMAIL` (server env, never
     taken from the request -- the endpoint cannot be pointed at any other account)
   - confirms that user's connection is actually `is_demo` (catches a misconfigured
     `NEWINMETER_DEMO_EMAIL` pointing at a real account, refuses instead of signing in)
   - calls `admin.auth.admin.generateLink({ type: "magiclink", email })` server-side and returns
     only its `hashed_token` (never the plaintext OTP, never the service-role key)
   - **never** creates a user, uses `signInWithPassword`, or issues a bespoke session -- only an
     already-existing `is_demo` user can ever be signed in this way
   - every failure (wrong token, unconfigured feature, misconfigured demo user, upstream Supabase
     error) returns the identical generic `401 { message: "Invalid or missing demo access." }`, so
     nothing distinguishes "wrong token" from "right token, something else broke"
2. The browser calls `supabase.auth.verifyOtp({ token_hash, type: "magiclink" })` with the same
   anon-key browser client every other sign-in path already uses. This -- not a redirect through
   `action_link`/`/auth/callback` -- is the correct redemption mechanism here: `action_link` only
   establishes a session via the PKCE `?code=` param when opened by the _same browser_ that called
   `signInWithOtp` (that browser is the only one holding the matching `code_verifier`); a
   server-admin-generated link has no such browser, so Supabase returns bearer tokens in a URL
   fragment instead, which never reaches a server at all. `verifyOtp` is Supabase's documented way
   to redeem a link generated out-of-band, and it produces a completely ordinary session through the
   ordinary client. From that point on the reviewer is a normal authenticated Supabase user, subject
   to the same RLS, dashboard loaders, Activities, and assistant code as everyone else.

When a token is used, it only ever exists in the URL bar and in-memory component state for the length
of that one click -- it is never written to `localStorage`, `sessionStorage`, or a cookie, and it's
discarded once the redirect fires.

**`NEWINMETER_DEMO_ACCESS_TOKEN` is a bearer secret for the recruiter/private-link path only**:
anyone holding the full demo URL can sign in as the demo account (though still bound by every
restriction below -- they can't reach LiveMopay, disconnect, or delete anything). Rotate it by
changing the env var and redeploying; the old URL stops working immediately, no database change
needed. The **public** `/login` button needs no secret at all -- it's protected by the same
`demoLogin` IP rate limit and the same server-side `is_demo` re-verification, not by a token, since
the account itself can't reach LiveMopay/sync/push/be deleted no matter who signs in.

- **`livemopay_connections.is_demo`** (`supabase/migrations/20260817000000_newinmeter_demo_accounts.sql`)
  marks one connection as demo. Everything else about it is a normal connection row: synthetic
  `account_id`/`company_id`/`property_id`/`account_label`, `status: 'connected'`, and no refresh
  token fields (the token-fields-consistency constraint allows all-null). It flows through the
  same ownership model, RLS, dashboard loaders, rollups, Activities, and assistant as any other
  connection -- there is no parallel demo data model or fake dashboard.
- **Never reaches LiveMopay.** `/api/sync` checks `connectionRow.is_demo` before any refresh-token
  decryption or network call and returns `403 { message, demoAccount: true }`. `/api/livemopay/connect`
  refuses to attach real credentials to a demo connection (`403`), and `beginLivemopayConnection`/
  `disconnectLivemopayConnection`/`deleteAccountForUser` (`src/lib/newinmeter-connection.ts`) throw
  `DemoAccountProtectedError` as a backstop even if a route forgot to check first. The Settings UI
  labels it "Demo dataset", disables the Sync control ("Demo data · Live sync unavailable"), and
  hides Disconnect/Delete -- but every one of those restrictions is enforced server-side, not just
  hidden in the UI.
- **Excluded from stale-sync notifications**: `listConnectionsForStaleCheck` filters
  `is_demo=eq.false`, since a demo connection's data is intentionally static and would otherwise
  look permanently stale.
- **Role/permissions**: seeded as a normal `role: 'user'` with `ai_assistant_enabled: true` and
  `activities_enabled: true` -- not an admin. `src/lib/demo/capabilities.ts` is the single policy
  table every route/UI affordance reads: Activity and notification-read-state mutations stay
  interactive for every visitor (allowing a shared credential to feel like a real, usable dashboard
  rather than a read-only screenshot); alert-rule edits, LiveMopay connect/sync, push, and account
  deletion are blocked.
- **Nightly reset** (`/api/cron/reset-demo`, `vercel.json`, `CRON_SECRET`-gated like the other
  crons) reruns the same reseed logic as `npm run seed:demo-account` every night, so the shared
  Activities/notification state above can't drift far from the canonical walkthrough no matter how
  many public visitors touch it during the day. A missing/misconfigured `NEWINMETER_DEMO_EMAIL` is a
  no-op here, not an error -- the public button already refuses to work in that case.
- **AI cost**: demo questions share one Supabase user id across every visitor (it's the same account
  for everyone), so the ordinary per-user `assistant` rate-limit policy is already a single pooled
  budget for all demo traffic combined. `/api/assistant` swaps in the tighter `assistantDemo` policy
  specifically for the `is_demo` connection and returns demo-specific copy ("connect your own
  LiveMopay account for unlimited use") once that shared allowance is exhausted for the day.
- **Indicator**: a small "Demo account · synthetic data" chip in the sidebar footer
  (`src/components/layout/app-shell.tsx`), with a quiet "View my own data" link next to it (signs out
  and returns to `/login`), makes it obvious a visitor isn't looking at someone's real electricity
  records and gives them an easy way to start their own, without nagging.

### Provisioning / resetting

```
NEWINMETER_DEMO_EMAIL=demo@example.com npm run seed:demo-account
```

The actual reseed logic lives in `src/lib/demo/reset.ts` (`resetDemoAccount`), shared by this CLI
script and the nightly `/api/cron/reset-demo` job above -- both callers produce identical state, so
they can never drift apart. The demo Supabase Auth user has **no password** -- sign-in goes
exclusively through the `/api/demo-login` magic-link flow above, so there's nothing to generate,
rotate, or leak from the seed script. `resetDemoAccount` finds-or-creates that Auth user
(email-confirmed, no password set), finds-or-creates its `livemopay_connections` row (refuses to
touch an existing connection that isn't already `is_demo`, so an email typo can never convert a real
account), wipes
only that connection's `energy_rows`/`capture_runs`/rollups/`dashboard_summary`/`usage_activities`,
regenerates ~10 weeks of synthetic data (`src/lib/demo/dataset.ts`), and runs it through the same
`finish_capture_run` RPC and `refresh_newinmeter_rollups_for_run` trigger a real sync uses -- rollups
are computed by production logic, never hand-derived in the script. Safe to rerun: a second run
resets the account deterministically instead of duplicating data. Needs the same Supabase
service-role env vars as the app; see `.env.example`.

The generated dataset (deterministically seeded, see `src/lib/demo/dataset.test.ts`) includes
weekday/weekend and morning/evening usage patterns, a few elevated-usage days, one obvious short
spike, daily fixed charges, several top-ups, a mid-range refund/credit, a tariff-band structure plus
one rate change partway through, and water usage -- enough for every assistant tool and comparison
view to return something real. Activities are seeded to loosely correlate with usage (geyser
mornings and a late-night-to-morning geyser, laundry, oven/cooking, an away stretch, a guests
evening) using the existing tag/colour model, not a separate demo representation.

## PWA badge and stale-data notifications

The installed PWA badges its home-screen icon when a user's data goes stale
(`isSyncStale`, `STALE_AFTER_HOURS = 6`). Two layers:

- **In-app (always on, no config):** `DataSyncAction` calls
  `navigator.setAppBadge(1)` / `clearAppBadge()` while the app is open, and the
  Settings "Enable badges" control (`BadgePermissionCard`) requests notification
  permission from a real tap and tries to reflect current staleness onto the
  icon right away. This foreground path works on desktop PWAs (macOS/Windows),
  but **iOS does not reliably paint the badge from a foreground call** -- on
  iPhone the icon only updates via the background push path below. The
  foreground call is still worth keeping for desktop and as the clear-on-open
  mechanism.
- **Background (Web Push, optional):** with VAPID keys configured, enabling
  badges also subscribes the device (`/api/push/subscribe`, stored in
  `push_subscriptions`). A daily Vercel cron (`vercel.json` ->
  `/api/cron/stale-check`, guarded by `CRON_SECRET`) scans connected accounts
  and sends **one** notification per stale episode -- dedupe lives on
  `livemopay_connections.stale_notified_at`, set when notified and cleared on
  the next successful sync, so the cron cadence is only detection resolution,
  not notification frequency. The service worker's `push` handler shows the
  notification (iOS requires every push be user-visible) and sets the badge
  from the worker -- this is what actually lights the iOS icon. The cron only
  ever _sets_ the badge; it's cleared when the user next opens the app and
  `DataSyncAction` sees fresh data.

Two iOS-specific gotchas learned the hard way, both handled in the code:

- `setAppBadge()` with **no argument** renders nothing on iOS (it has no
  indeterminate badge). Always pass a count -- the code passes `1`.
- The badge only appears via a delivered push, not from toggling the Settings
  switch. That's expected iOS behavior, not a bug.

Env vars (see `.env.example`; all optional -- the in-app badge works without
them, these add the background layer):

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` -- generate with
  `node -e "console.log(require('web-push').generateVAPIDKeys())"`. The public
  key is build-time inlined into the client bundle, so **redeploy after
  setting it**, not just restart.
- `VAPID_SUBJECT` -- optional `mailto:` contact, defaults to
  `mailto:support@newinmeter.app`.
- `CRON_SECRET` -- shared secret Vercel Cron sends as
  `Authorization: Bearer <CRON_SECRET>`; the stale-check route rejects anything
  else. On the Hobby plan cron runs once daily (`0 6 * * *`); for a tighter
  cadence point an external scheduler (e.g. Upstash QStash) at the same
  endpoint with the same header.

## Testing

`npm test` runs the vitest suite (`npm run test:watch` for watch mode, `npm run test:coverage`
for a coverage report). Tests are co-located as `*.test.ts` next to the code they cover.

Coverage is deliberately focused on pure, deterministic logic with real business/money stakes
rather than chasing a percentage: `analytics.ts` (the core spend/usage/projection math),
`day-breakdown.ts`, `period-comparison.ts`, `filters.ts` (date-range presets), `csv.ts`/`export.ts`
(ledger row parsing and CSV/XLSX export), `token-encryption.ts` (AES-256-GCM round-trip and
tamper detection), `energy-data.ts`'s PostgREST query builders, the dashboard metric cards, and
every assistant tool in `src/lib/assistant/tools` (what the AI is allowed to cite as fact,
verified against fixture data with hand-computed expected values). `server-only` is aliased to a
no-op stub for tests (see `vitest.config.ts`) since the real package throws outside a webpack
"react-server" bundle.

Not covered: React components/hooks (would need jsdom + Testing Library and heavy
`next/navigation` mocking for uncertain payoff), and thin I/O wrappers around Supabase/LiveMopay
(`dashboard-data.ts`, `newinmeter-sync.ts`, `supabase-rest.ts`) where the only real logic is "does
the network call happen" -- lower value than the math it's fetching data for.
`newinmeter-connection.ts` is mostly in that same bucket, except its demo-account guards
(`newinmeter-connection.test.ts`) are real branching logic with a security consequence, so those
are covered. `src/lib/demo/dataset.ts` (the recruiter demo dataset generator) is pure and fully
covered, including a check that it produces meaningful output through the real `createAnalytics`
and assistant tool handlers (`dataset.analytics.test.ts`).

The assistant's Responses API tool loop (`openai.ts`, mocking the `openai` SDK's `responses.create`),
its structured-response validation and JSON-Schema/zod cross-check (`response-schema.ts`), every
alert tool (ownership, feature gating, dedup-semantics grounding), and `/api/assistant` +
`/api/assistant/actions` (auth, feature gates, demo blocking, ownership, arbitrary-type/threshold
rejection, no-mutation-before-confirmation) are all covered the same way. The assistant's rich UI
(`src/components/assistant`) is the one component surface with real component tests
(`@testing-library/react` + `// @vitest-environment jsdom`, same pattern as
`alert-rule-row.test.tsx`) -- confirm/cancel behavior, demo/feature-flag gating of mutation
buttons, and that no raw tool name ever renders -- since a proposed mutation not actually staying
unconfirmed until clicked is a correctness property worth testing directly, not just inferring from
the domain layer.

## Legal pages

`/privacy` and `/terms` are static, unauthenticated pages (`src/app/privacy`, `src/app/terms`,
allowlisted in `src/middleware.ts`) describing what's collected, the third parties involved
(LiveMopay, OpenAI, Supabase, Vercel), and self-service account deletion. Linked from the signed-
out auth pages and the signed-in sidebar footer.

## Data Semantics

Rows are normalized in `src/lib/newinmeter-web.ts` (upstream ledger response) and
`src/lib/csv.ts` (Supabase row shape), then summarized in `src/lib/analytics.ts`. Unchanged by
multi-user support:

- fixed daily charges are included in total spend
- fixed daily charges are excluded from kWh, hourly usage, and tariff analysis
- top-ups appear in raw data and balance history context
- top-ups are excluded from electricity spend
- water charges have their own spend/usage tracking, separate from electricity
- interval rollup timestamps are treated as the start of their displayed 30-minute
  slot; activity calculations include `starts_at` and exclude `ends_at`
- activity tags describe correlation and household context only; they do not attribute
  total household consumption to an individual appliance

## Project Structure

- `src/app` - App Router pages; `(app)` route group (`/`, `/data`, `/settings`, `/admin`) shares
  one layout/sidebar, plus `/login`, `/connect`, `/auth/callback`, `/privacy`, `/terms`
- `src/app/api/admin` - admin-only routes: users, feature rollout, and Diagnostics
- `src/app/api/account/delete` - self-service account + data deletion
- `src/app/api/livemopay` - LiveMopay connection routes (connect, select-account, disconnect, status)
- `src/app/api` - sync, assistant, export, energy-rows, day-intervals routes (all authenticated,
  all rate-limited)
- `src/app/api/assistant/actions` - server-side execution for a user-confirmed assistant-proposed mutation (add Activity, set/disable an alert, sync) -- never called by the model directly
- `src/components/admin` - admin users/features UI and responsive Diagnostics view
- `src/components/auth`, `src/components/connect` - sign-in and LiveMopay connection UI
- `src/components/assistant` - global assistant provider/dialog (mounted once in `app-shell.tsx`), rich response rendering (evidence chips, visualization cards, action confirmation cards), and the dashboard trigger button
- `src/components/dashboard` - dashboard controls and insight sections
- `src/components/charts` - Recharts chart components
- `src/components/data` - Supabase-backed data table (`columns.ts` is the shared column
  label/alignment source used by both the real table and its loading skeleton)
- `src/components/settings` - connection management, delete-account card
- `src/components/ui` - shared presentation components (includes `switch.tsx` for admin toggles)
- `src/components/layout/document-shell.tsx` - shared layout for the static `/privacy`, `/terms` pages
- `src/lib/supabase` - browser/server/admin Supabase client boundaries
- `src/lib/auth` - authenticated-session resolution, including `requireAdminSession`
- `src/lib/diagnostics` - health classification, safe operational events, scheduler heartbeat,
  admin push targeting, and the bounded daily LiveMopay contract canary
- `src/lib/user-roles.ts` - role/permission reads and writes (`user_roles` table)
- `src/lib/rate-limit.ts` - Upstash-backed per-user rate limiting
- `src/lib/assistant` - Responses API tool loop (`openai.ts`), system prompt, structured response
  contract + validation (`response-schema.ts`), navigation destination resolver, and grounded tools
  (`tools/`, including the alert tools)
- `src/lib/newinmeter-web.ts` - LiveMopay Firebase auth, account discovery, ledger fetch (pure, argument-based)
- `src/lib/newinmeter-connection.ts` - LiveMopay connection persistence (encrypted tokens), account
  deletion, demo-account protections (`DemoAccountProtectedError`)
- `src/lib/newinmeter-sync.ts` - connection-scoped ledger sync into Supabase
- `src/lib/demo/dataset.ts` - pure, deterministic synthetic dataset generator for the demo account
- `src/lib` (remainder) - Supabase access, CSV normalization, filtering, formatting, and analytics
- `supabase/migrations` - database schema
- `scripts/backfill-legacy-owner.ts` - one-time ownership backfill for pre-multi-user data
- `scripts/seed-demo-account.ts` - provisions/resets the shared recruiter demo account
- `MULTI_USER_SETUP.md` - full hosted setup guide

## Ideas / not yet done

- Auto-sync: silently trigger a sync when a user returns after `lastSyncedAt` is older than
  some cooldown (6-12h?), instead of always requiring the manual Sync button. Needs a cooldown
  so it doesn't hammer/flag the LiveMopay portal (it's scraped, not a real API) -- shouldn't
  fire on every visit.

## Legacy Local Setup

`legacy/adb-ingestion/` (`newinmeter_web.py`, `capture_livemopay.py`, `refresh_and_sync.py`) is a
standalone Python CLI predating multi-user support -- originally this repo's whole ingestion
path, from back when it was called `livenopay`. It authenticates against LiveMopay directly
(`NEWINMETER_WEB_EMAIL`/`NEWINMETER_WEB_PASSWORD`, or ADB against an Android device/emulator),
writes `livemopay_energy.csv` locally, and syncs it to Supabase with the service-role key --
independent of Supabase Auth and the connection flow described above. It is not used by the
deployed multi-user app; nothing in `src/` calls into it or vice versa.

It still writes into the same `energy_rows`/`capture_runs`/rollup tables as the hosted app (no
second schema), scoped to one `connection_id` resolved from `NEWINMETER_LEGACY_TARGET_USER_ID`,
and finishes each run through the same `finish_capture_run` RPC the hosted sync route uses, so
rollups and `dashboard_summary` update exactly as they would from a real in-app sync. Use it only
as a legacy/demo path for your own single account -- see
[legacy/adb-ingestion/README.md](./legacy/adb-ingestion/README.md) for the full setup, safety
model, and command reference, [SETUP.md](./SETUP.md) for the underlying Android/ADB and web-API
mechanics, and the "Legacy local-only setup" section of `.env.example` for every environment
variable.

    npm run refresh:emulator          # ADB: launch/open the emulator, capture, sync
    npm run refresh:emulator -- --full
    npm run refresh:emulator -- --skip-capture
    python3 legacy/adb-ingestion/refresh_and_sync.py --source web
