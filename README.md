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

It also includes an in-app assistant that answers grounded questions about the currently selected
date range: comparisons, top usage periods, top-up activity, spikes, and balance patterns, scoped
to the signed-in user's own data. Assistant access is a per-user permission an admin can revoke,
and every assistant call is rate-limited server-side regardless of what the UI shows.

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
```

There are no job queues, polling workers, or remote command systems. The deployed app never
depends on local files -- no CSV, no session file. See `MULTI_USER_SETUP.md` for the full
ownership model, migration order, and setup steps.

## Supabase Schema

Apply the migrations in `supabase/migrations` in timestamp order -- see `MULTI_USER_SETUP.md`
section 6 for the exact order and where the legacy-owner backfill fits in. The multi-user
migrations add:

- `livemopay_connections` -- one row per user's LiveMopay connection: discovered account/company/
  property ids, an encrypted refresh token (AES-256-GCM, nullable when disconnected), and status.
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

The assistant is a grounded analyst for the active dashboard date range, scoped to the signed-in
user's own connection. It only answers using the tool results below and never invents numbers or
dates, and never runs arbitrary SQL.

1. `get_scope_overview` - totals, peaks, balance, and generated insights for the active range
2. `get_balance_runout` - estimate when the current balance runs out and whether it covers month-end
3. `compare_previous_period` - compare the active range to the immediately preceding range of equal length
4. `compare_calendar_months` - compare the latest calendar month in scope to the prior month and return month-by-month breakdowns
5. `get_top_days` - highest days by spend, usage, or average tariff
6. `get_top_hours` - highest hours by spend or usage
7. `explain_day` - explain a single day with daily rollups plus top half-hour intervals
8. `get_recent_topups` - list recent top-ups in the active range
9. `get_water_overview` - summarize water charges in the active range

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
real money per call; everything else defaults to 60/minute, 1000/day.

Needs one of these env var pairs (see `.env.example`):

- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` -- signing up directly at
  [upstash.com](https://upstash.com)
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` -- Vercel's Upstash Marketplace storage integration,
  which keeps the older Vercel KV variable names

## Account deletion

Users can permanently delete their own account from Settings (type `DELETE` to confirm):
`deleteAccountForUser` (`src/lib/newinmeter-connection.ts`) removes their `livemopay_connections`
row (cascading to every table keyed off it -- see "Supabase Schema" above) and deletes their
Supabase Auth user entirely. Fully self-service, no admin action required.

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
(`dashboard-data.ts`, `newinmeter-sync.ts`, `newinmeter-connection.ts`, `supabase-rest.ts`) where
the only real logic is "does the network call happen" -- lower value than the math it's fetching
data for.

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
- `src/app/api/admin` - admin-only routes: list users, set role, set AI-assistant permission
- `src/app/api/account/delete` - self-service account + data deletion
- `src/app/api/livemopay` - LiveMopay connection routes (connect, select-account, disconnect, status)
- `src/app/api` - sync, assistant, export, energy-rows, day-intervals routes (all authenticated,
  all rate-limited)
- `src/components/admin` - admin user list/role/permission table
- `src/components/auth`, `src/components/connect` - sign-in and LiveMopay connection UI
- `src/components/assistant` - dashboard assistant launcher and dialog UI
- `src/components/dashboard` - dashboard controls and insight sections
- `src/components/charts` - Recharts chart components
- `src/components/data` - Supabase-backed data table (`columns.ts` is the shared column
  label/alignment source used by both the real table and its loading skeleton)
- `src/components/settings` - connection management, delete-account card
- `src/components/ui` - shared presentation components (includes `switch.tsx` for admin toggles)
- `src/components/layout/document-shell.tsx` - shared layout for the static `/privacy`, `/terms` pages
- `src/lib/supabase` - browser/server/admin Supabase client boundaries
- `src/lib/auth` - authenticated-session resolution, including `requireAdminSession`
- `src/lib/user-roles.ts` - role/permission reads and writes (`user_roles` table)
- `src/lib/rate-limit.ts` - Upstash-backed per-user rate limiting
- `src/lib/assistant` - assistant prompt, tool loop, and grounded analytics tools
- `src/lib/newinmeter-web.ts` - LiveMopay Firebase auth, account discovery, ledger fetch (pure, argument-based)
- `src/lib/newinmeter-connection.ts` - LiveMopay connection persistence (encrypted tokens), account deletion
- `src/lib/newinmeter-sync.ts` - connection-scoped ledger sync into Supabase
- `src/lib` (remainder) - Supabase access, CSV normalization, filtering, formatting, and analytics
- `supabase/migrations` - database schema
- `scripts/backfill-legacy-owner.ts` - one-time ownership backfill for pre-multi-user data
- `MULTI_USER_SETUP.md` - full hosted setup guide

## Ideas / not yet done

- Auto-sync: silently trigger a sync when a user returns after `lastSyncedAt` is older than
  some cooldown (6-12h?), instead of always requiring the manual Sync button. Needs a cooldown
  so it doesn't hammer/flag the LiveMopay portal (it's scraped, not a real API) -- shouldn't
  fire on every visit.

## Legacy Local Setup

`newinmeter_web.py`, `capture_livemopay.py`, and `refresh_and_sync.py` are a standalone Python CLI
that predates multi-user support. It authenticates against LiveMopay using
`NEWINMETER_WEB_EMAIL`/`NEWINMETER_WEB_PASSWORD` from `.env.local`, writes `livemopay_energy.csv`
locally, and syncs it to Supabase with the service-role key -- independent of Supabase Auth and
the connection flow described above. It is not used by the deployed multi-user app; nothing in
`src/` calls into it or vice versa.

Use it only if you're running a personal, single-owner instance and don't need multi-user
support. See [SETUP.md](./SETUP.md) for the full Android/ADB and web-API setup, and the
"Legacy local-only setup" section of `.env.example` for its environment variables.

    python3 refresh_and_sync.py --source web
