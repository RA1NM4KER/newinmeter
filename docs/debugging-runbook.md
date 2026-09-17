# Debugging runbook: tracing a user's issue

Reference for an agent (or a human) handed a bug report like "user X isn't getting the
electricity data" or "people say the email code never arrives," so it can go straight to the
right place instead of rediscovering the stack from scratch. None of the identifiers below are
secrets, they're project references, not credentials. Actually acting on them still requires the
operator's own authenticated Supabase/Vercel/Resend session (this repo has no service tokens
committed anywhere).

## The three systems and what each one is for

| System | What it's for | Where to look |
|---|---|---|
| **Supabase** (project "Livenopay", ref `xpzpfmhkcbaqcnauqqzi`) | Auth, database, the unified log stream (auth, postgrest, postgres) | Supabase MCP tools (`execute_sql`, `query_logs`, `list_tables`), or the dashboard |
| **Vercel** (project `newinmeter`, team scope `ra1nm4kers-projects`, domain `newinmeter.vercel.app`) | Hosting, deployments, serverless function/edge logs, cron jobs (the 3 in `vercel.json`) | `vercel` CLI (needs `--scope ra1nm4kers-projects` or it defaults to the wrong account) |
| **Resend** (sending domain `kefas.co.za`) | Outbound transactional email (Supabase Auth's custom SMTP points here, see Supabase dashboard → Authentication → Emails → SMTP Settings) | resend.com dashboard: Emails (per-message delivery status), Domains (SPF/DKIM/DMARC record status) |

## Given one user's email: trace their whole state

Start here for almost any "user X has a problem" report. One query, then branch based on what
you see:

```sql
with target as (
  select id, email, created_at, last_sign_in_at from auth.users where lower(email) = lower('<email>')
)
select
  t.email, t.created_at as user_created_at, t.last_sign_in_at,
  ur.role,
  c.id as connection_id, c.status as connection_status, c.livemopay_email,
  c.account_id, c.company_id, c.property_id, c.account_label,
  c.data_state, c.last_synced_at, c.last_error,
  c.auto_sync_enabled, c.last_auto_sync_status, c.last_auto_sync_error,
  c.pending_accounts,
  (select count(*) filter (where charge_kind='energy') from energy_rows er where er.connection_id=c.id) as energy_rows,
  (select count(*) filter (where charge_kind='water') from energy_rows er where er.connection_id=c.id) as water_rows
from target t
left join public.user_roles ur on ur.user_id = t.id
left join public.livemopay_connections c on c.user_id = t.id;
```

Read the result:

- **No row in `auth.users` at all**: they never signed up, or typo'd the email. Check Resend
  ("Emails" tab, search the address) to see if a signup confirmation ever sent.
- **User exists, `connection_id` is null**: signed in, never attempted (or never finished)
  connecting LiveMopay. Check the funnel counts (`onboarding_funnel_daily`) for
  `connect_screen_viewed` vs `connect_attempted` same-day to see if this is a pattern, not just
  this one person.
- **`connection_status = 'pending_selection'`, `pending_accounts` not null**: LiveMopay returned
  multiple accounts for that login and they never picked one. `finalizeLivemopayAccountSelection`
  (`src/lib/newinmeter/connection.ts`) is what resolves this, normally triggered by the UI's
  account picker, not something to fix by hand.
- **`last_error` or `last_auto_sync_error` set**: read it, it's the actual upstream error string.
- **"Data hasn't synced in a while" but `last_error` is null and `data_state` is still `warm`
  (not cold-storage)**: check whether the connection is paused for inactivity before assuming
  anything is broken. `select auto_sync_is_paused_for_inactivity(connection_id);` (default
  14-day threshold) tells you directly. This isn't a stored flag, it's live-computed from
  `user_activity_days` plus an alerts exemption, same as cold storage's own 45-day check, just a
  much earlier and non-destructive version of it (pauses scheduling, purges nothing). If it
  returns true, the account genuinely stopped syncing on purpose because the person stopped
  opening the app, not a bug. It self-resolves the moment they open the app again (the visit's
  own `record_user_activity()` call rearms `next_sync_at` immediately), so if someone says "it
  wasn't syncing but now it is" after they just reopened it, that's this working as intended, not
  something that silently fixed itself. As of `classifyConnectionHealth`
  (`src/lib/diagnostics/health.ts`) checking `pausedForInactivity`, `/admin/diagnostics` itself
  already accounts for this and won't flag a paused connection as Critical, so this manual check
  is mainly for tracing things diagnostics doesn't cover (a direct SQL question, a different
  admin surface). For 9 real connections before this was fixed, `next_sync_at` freezing on pause
  meant the "overdue" age just grew forever, so every one of them sat pinned at Critical
  indefinitely, a pure false positive next to genuine failures on the same page, until a user
  actually looked at the 3 flagged that day and asked whether they were actually broken.
- **Connection looks healthy but `energy_rows`/`water_rows` look wrong** (e.g. one is zero when
  it shouldn't be): pull the next-level detail below before assuming it's a data availability
  gap upstream, it might be a parser bug (this exact shape, water present/energy zero, was a real
  ledger-label-regex bug once, see `git log --oneline -- src/lib/newinmeter/web.ts`).
- **Data table's Band column shows "Not specified" for a real (non-demo) user, or
  `tariff_band_approaching` seems unavailable for them**: check
  `select tariff_profile from public.livemopay_connections where id = '<connection_id>';` before
  assuming anything about their usage data itself. `tariff_profile` is NOT auto-assigned at
  connect time (`beginLivemopayConnection` never touches it), it's only ever set by a reviewed,
  one-time migration matching a specific `company_id` (currently `'43'`, Newinbosch, see
  `20260824050000_*.sql`'s own extensive comment on why this is deliberately not automatic: the
  author didn't trust `company_id` as a permanent unsupervised signal, only as something worth a
  human re-checking before each assignment). This means **every new connection since that
  migration ran silently has `tariff_profile = null` until someone notices and re-runs the same
  reviewed backfill**, which is exactly what happened for 3+ weeks and 9 real connections before
  this was caught. If you find drift like this again, the fix is the same shape: re-run the
  freshness check the original migration's comment specifies
  (`select company_id, count(*), count(distinct account_id), count(distinct property_id) from
  livemopay_connections where is_demo = false group by company_id;`), confirm no new estate has
  shown up, then write a new migration re-applying the identical predicate (self-limiting, safe
  to re-run, can't double-apply). Once `tariff_profile` is set, `npm run backfill:tariff-bands`
  (see its own comment for the `--conditions=react-server` requirement) resolves the actual
  `tariff_band` values on existing rows, new syncs resolve it automatically going forward
  (`sync.ts` calls `resolveTariffBand` on every insert). A remaining handful of unresolved rows
  after running it is expected if the demo connection has any (it's deliberately excluded,
  `is_demo = true`, and has no profile by design), not a sign the run failed.
- **User reports a one-time "Application error: a server-side exception has occurred" on first
  load right after signing up, but reloading fixes it and everything works fine after**: this
  matches a real fixed bug, a duplicate-key crash in `getOrCreateUserPermissions`
  (`src/lib/user-roles.ts`). Two concurrent requests for a brand-new user could both pass the
  select-empty check before either had inserted, then race to insert the same `user_id`, and the
  loser hit a `user_roles_pkey` unique violation that surfaced as an unhandled 500. Fixed by
  making the fallback write an upsert instead of a plain insert, but the general shape (a
  `cache()`-wrapped select-then-insert, where `cache()` only dedupes within a single request, not
  across two genuinely concurrent ones) could recur anywhere else that pattern gets copied. If you
  see a one-time crash immediately after account creation that self-resolves on retry, suspect
  this class of bug before anything else, check `system_events`/Vercel error logs for a
  `duplicate key` or `_pkey` message around the timestamp to confirm.

## Is this one user, or everyone like them?

Before concluding a bug is specific to one account, check whether the same pattern shows up
across a cohort: same `property_id`, same signup day, same auth provider, whatever dimension
fits the report. A single account with `energy_rows = 0` could be a real per-user bug or it could
be a property-wide upstream data gap, and those two conclusions call for completely different
fixes. Compare siblings first:

```sql
select id, account_label, status,
  (select count(*) filter (where charge_kind='energy') from energy_rows er where er.connection_id=c.id) as energy_rows,
  (select count(*) filter (where charge_kind='water') from energy_rows er where er.connection_id=c.id) as water_rows
from public.livemopay_connections c
where property_id = '<same property_id as the reported user>'
order by account_label;
```

If every connection on that property shows the same shape, the bug (or the missing upstream
data) is systemic, not account-specific, don't chase a per-user fix. If only the reported user's
row looks different from their otherwise-identical siblings, that's the signal to go deeper on
that one connection specifically (as in the water/electricity parser bug, where the actual answer
turned out to be "this account's raw ledger uses a label format none of its neighbors use," found
only by comparing against the cohort first).

## Onboarding funnel: is this a widespread friction point?

`onboarding_funnel_daily` is an aggregate, privacy-free daily counter per funnel step (see
`src/lib/funnel.ts` for the full allow-listed event list). Useful for turning "I think people are
struggling to sign up/connect" into an actual number before acting on a hunch:

```sql
select event_type, event_count
from public.onboarding_funnel_daily
where event_date = current_date
order by event_type;
```

Read it as a funnel, top to bottom: `login_page_viewed` → `sign_in_started_google` /
`sign_in_started_email` → `sign_in_completed_google` / `sign_in_completed_email` →
`connect_screen_viewed` → `connect_attempted` → `connect_invalid_credentials` →
`connect_succeeded` → `initial_sync_succeeded` / `initial_sync_failed`. A big drop between two
adjacent steps is the actual friction point, don't guess which step is the problem, this table
tells you directly. Compare `event_date` across a few recent days if you want a trend rather than
one day's snapshot.

## Finding stalled signups (never connected, never synced)

```sql
select u.email, u.created_at, u.last_sign_in_at
from auth.users u
left join public.livemopay_connections c on c.user_id = u.id
where c.id is null
order by u.created_at desc;
```

Useful both for debugging ("did this person even reach the connect step") and for the human
follow-up (a support/outreach email to people who stalled partway through onboarding).

## Sync history for one connection

```sql
select status, mode, trigger, started_at, finished_at, rows_in_csv, rows_synced, error
from public.capture_runs
where connection_id = '<connection_id>'
order by started_at desc
limit 10;
```

`mode = 'full'` re-fetches everything from `2000-01-01` (see `runLivemopaySync` in
`src/lib/newinmeter/sync.ts`); `'incremental'` only fetches since the latest stored period. If you
need to force a fresh full resync to backfill something that was fixed after the fact (like the
parser bug above), see "Replaying a sync manually" below, don't just tell the user to click Sync
if the bug already ran and silently dropped data, a resync with the same buggy code changes
nothing.

## Auth / login / OTP issues

Supabase's own auth logs (`source = 'auth_logs'` in the unified `logs` table) show every sign-in
attempt, OTP request, and rate-limit hit, with real error codes:

```sql
select event_message
from logs
where source = 'auth_logs'
  and (event_message ilike '%<email>%' or event_message ilike '%rate limit%' or event_message ilike '%error%')
order by timestamp desc
limit 50
```

(`query_logs` caps the window at 24h and defaults to "now minus 24h", pass explicit
`iso_timestamp_start`/`iso_timestamp_end` for anything older.)

Login method / provider split (useful for "is Google or email OTP actually working better"
questions):

```sql
select log_attributes['provider'] as provider, log_attributes['login_method'] as login_method, count(*) as n
from logs
where source = 'auth_logs' and log_attributes['action'] = 'login'
group by provider, login_method
order by n desc
```

A `429` with `error_code: over_email_send_rate_limit` and a message about "N seconds" is the
harmless client-side resend cooldown, not a real problem. A sustained pattern of that error would
be a real one, but a single hit isn't.

**If the report is "the code never arrived"**: check Resend's Emails log (resend.com/emails,
filter by recipient) before assuming anything is broken. If it shows `Delivered`, the email left
our system fine, the remaining possibilities are spam-foldering (check the sending domain's SPF/
DKIM/DMARC status under Resend → Domains → `kefas.co.za` → Records) or the user is looking at the
wrong email (first-ever sign-in sends the "Confirm sign up" template, not "Magic link or OTP",
both contain a code but under a different subject line, see `login-form.tsx`'s two different
`trackFunnelEvent` call sites for the split, and Supabase dashboard → Authentication → Emails →
Templates for the actual template content). Don't conclude "SMTP is misconfigured" without
actually checking SMTP Settings first, the fastest way to rule it out is exactly this: was it
Delivered, and does the domain have valid SPF/DKIM.

## Vercel logs

```sh
vercel logs --project newinmeter --scope ra1nm4kers-projects --environment production \
  --since 3h --level error --limit 500 --json > /tmp/nm-logs.jsonl
```

Gotchas:

- **Always pass `--scope ra1nm4kers-projects`**, the CLI defaults to your personal account and
  will report "project not found" or link to the wrong project otherwise.
- Plain `vercel logs` without `--level error` mostly returns `edge-middleware` request-completion
  lines with empty `logs: []`, it does not reliably surface `console.log`/`console.warn` output
  from inside a serverless function invocation in this CLI version. If you need to see a specific
  `console.warn`/`console.error` line from application code and it's not showing up, that's a
  logging/capture limitation of this pull method, not proof the code path wasn't hit, consider a
  direct replay instead (below).
- `--since` accepts relative windows like `3h`, `24h`.

## Replaying a sync (or any server-only logic) manually

Sometimes the fastest way to confirm what's actually happening (parser bug, upstream API shape,
whether a fix actually works) is to run the real production code path directly against one
user's real data, rather than guessing from logs. Pattern:

```sh
npx tsx --conditions=react-server --env-file=.env.local <script>.ts
```

**Sharp edge**: `--conditions=react-server` is required for anything importing a
`server-only`-marked module, but it breaks on any file that also imports `cache` from `react`
(`src/lib/newinmeter/connection.ts` does this for `getConnectionForUser`). You'll get
`This entry point is not yet supported outside of experimental channels` from
`react.shared-subset.development.js`. Work around it by not importing that file, read/write the
same rows directly:

```ts
import { adminSupabaseFetch, adminSupabaseRequest } from "@/lib/supabase-rest";
import { decryptRefreshToken } from "@/lib/token-encryption";
import { refreshLiveMopaySession, normalizeLedgerRow } from "@/lib/newinmeter/web";
// or import { runLivemopaySync } from "@/lib/newinmeter/sync"; for a real end-to-end resync
```

This is exactly how the "water-only account" bug was actually diagnosed: pull the connection
row's encrypted refresh token, decrypt it, refresh the LiveMopay session, hit the real ledger
endpoint, and look at the raw payload next to what the parser did with it, rather than
speculating from aggregate row counts alone.

Write throwaway scripts to the scratchpad directory, not into `scripts/` (that directory is for
real, reusable operational scripts committed to the repo, not one-off investigation code).

## Expect permission friction on certain actions

Some actions in an agent session get blocked automatically and need the operator's explicit
confirmation, budget time for that back-and-forth rather than treating a denial as an error to
work around. Ones actually hit while building this runbook:

- Applying a Supabase migration (`apply_migration`) to the live project, treated as a production
  change requiring confirmation, not a sandbox action.
- Installing a Vercel Marketplace integration (`vercel integration add ...`), since it can incur
  billing on the operator's account.
- Occasionally a plain read-only `SELECT` gets denied by the permission classifier for no
  obvious content-based reason, retrying the identical query a moment later has worked every
  time this happened, it's not a signal that the query itself was wrong.

If something gets denied, don't assume the action is impossible, ask the operator directly (or
retry once for the read-only case above), most of these are one confirmation away.

## Real-device-only UI bugs: don't trust Chrome DevTools mobile emulation as proof

A layout bug can be 100% real and 100% invisible in Chrome's device toolbar/responsive mode,
because that's still the Blink engine at a resized viewport, not real WebKit/Safari. "Looks fine
in Chrome mobile view" is not evidence a mobile layout bug doesn't exist, only that it isn't a
viewport-width/breakpoint problem. If a user reports something broken only on their phone, ask
early whether it also reproduces in real mobile Safari (not just the installed PWA, and not just
Chrome's phone emulation) before spending time on CSS theories, the answer changes where the bug
can possibly be:

- Broken in the PWA but fine in a normal Safari tab: service worker serving a stale/mismatched
  cached asset, not a CSS bug at all (see `public/sw.js`, `cacheFirstStatic` for `_next/static/*`
  is cache-first with no invalidation beyond content-hashed URLs).
- Broken in both the PWA and a plain Safari tab, fine in Chrome (any mode): a genuine WebKit-only
  rendering difference. Worth specifically suspecting nested flex containers: a flex item's width
  depending on `align-items: stretch` propagating through more than one level of
  flex-in-flex-in-flex (button → `flex-col` → row div, in this case) is a real, documented category
  of Safari-only bugs (see the community "flexbugs" list). This exact shape hit
  `DataRowCard` (`src/components/data/data-table.tsx`): each row's two-item `justify-between` line
  rendered content packed to the left with dead space on the right, only on a real iPhone (an
  iPhone X specifically, capped at iOS 16), only for this card (its sibling cards in Activities/
  Admin use a plain `<div onClick>` instead of a `<button>` and were unaffected). `appearance-none`
  on the button (resetting Safari's native control chrome) did **not** fix it, ruling that theory
  out. The actual fix was removing the nested flex dependency entirely: made the outer button
  `block` with `space-y-*` for vertical stacking instead of `flex flex-col gap-*`, so each row's
  width comes from plain block flow (unambiguous in every engine) rather than inherited
  flex-stretch, keeping only one flat flex context per row for the actual left/right split.
- If neither theory fits and you don't have a Mac to actually inspect the real device, say so and
  ask for one rather than guessing further CSS properties one at a time. Real Safari Web Inspector
  (device connected to a Mac via cable, Settings → Safari → Advanced → Web Inspector on the phone,
  then Safari's Develop menu on the Mac) gives you the actual computed box model on the broken
  element instead of inferring it from a photo, and is faster than repeated round trips of "try
  this, does it look right now."

## General principle

Verify against real data before concluding anything, especially before telling a user "that's
not a bug" or "that's working as intended." Every conclusion in this doc's own worked example
(the water/electricity investigation) that turned out wrong was wrong because it stopped at an
aggregate count instead of pulling the actual raw payload one level deeper. When in doubt, go one
level closer to the actual bytes: from a rollup table to `energy_rows`, from `energy_rows` to the
raw LiveMopay ledger response, from "delivered per Resend" to actually checking the domain's SPF/
DKIM/DMARC records.
