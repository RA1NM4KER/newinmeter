# AGENT.md

Operating guide for AI agents working in this repo. For product/architecture depth, read
`README.md` first, then `MULTI_USER_SETUP.md` for the full hosted setup and migration order. If
the task is tracing a user-reported bug (signup, sync, email delivery, "why does the diagnostics
page say X"), go straight to `docs/debugging-runbook.md` instead, it has the actual project
identifiers (Supabase project ref, Vercel scope, Resend domain) and the exact queries/commands to
start with. This file is the practical "how to work here" layer on top of those.

## What this is

NewinMeter: a Next.js (App Router) multi-user dashboard that pulls a user's LiveMopay
(prepaid electricity/water) ledger history into Supabase and renders usage, spend, balance,
and an AI assistant on top of it. Each user connects their own LiveMopay account with their
own credentials; data is row-level-security-scoped per user in Postgres.

## Commands

```
npm install
npm run dev              # Next.js dev server
npm run build             # production build
npm test                  # vitest run (co-located *.test.ts / *.test.tsx)
npm run test:watch
npm run test:coverage
npm run lint               # next lint
npm run format             # prettier --write .
npx tsc --noEmit -p .     # typecheck (no dedicated npm script, run directly)
```

Always run `npm test` and `npx tsc --noEmit -p .` on touched areas before considering a change
done. Full `npm test` takes about 30 seconds. One test file
(`src/lib/meter-device-cli.smoke.test.ts`) fails on plain `npx vitest run <file>` outside the
full suite context due to a `tsx --conditions=react-server` module resolution quirk; this is
pre-existing and unrelated to most changes, confirm with `git stash` before assuming you broke
it.

Scripts under `scripts/` (backfills, demo seeding, device creation) run via
`tsx --conditions=react-server --env-file=.env.local scripts/<name>.ts`, see the `package.json`
script entries for the exact invocation per script. The `--conditions=react-server` flag is
required because these scripts import `server-only`-marked lib modules, but it has a sharp edge:
anything that also imports `cache` from `react` (for example `src/lib/newinmeter/connection.ts`)
will throw `This entry point is not yet supported outside of experimental channels` under that
flag, because `react-server` resolves `react`'s own package to a restricted subset entry point.
If you need functionality from a file like that in a one-off script, read/write the same data
directly via `adminSupabaseFetch`/`adminSupabaseRequest` (`src/lib/supabase-rest.ts`) and
`decryptRefreshToken`/`encryptRefreshToken` (`src/lib/token-encryption.ts`) instead of importing
the `cache()`-wrapped export.

## Code conventions actually used here

- **Comments explain *why*, not what.** This codebase leans heavily on comments that record a
  non-obvious constraint, a prior incident, or a reason an alternative was rejected, right above
  the code that depends on it. Match that style: don't add comments that restate the code, do
  add one when a future reader (human or agent) would otherwise "fix" something that's
  intentional.
- **No dashes as sentence punctuation in new prose you write** (commit messages, PR
  descriptions, comments you author). Use a comma, colon, or split into two sentences instead of
  `--` or an em dash. The existing codebase itself is full of `--` (it predates this rule), don't
  do a repo-wide rewrite to "fix" it, just don't add more.
- **Validate at trust boundaries with zod**, trust internal code otherwise. See
  `src/lib/assistant/response-schema.ts` and every API route's request schema for the pattern.
- **No speculative abstraction.** Three similar call sites is fine; don't extract a shared
  helper until a real fourth need shows up doing something meaningfully different.
- Server-only modules start with `import "server-only";` as the first line. Respect that
  boundary, don't import a server-only module from client-component code.

## Architecture pointers (see README.md for full depth)

- `src/lib/newinmeter/{web,connection,sync}.ts`: LiveMopay auth/fetch (`web.ts`, pure,
  argument-based), connection persistence and encrypted-token handling (`connection.ts`,
  imports `cache` from `react`, see the script gotcha above), and the sync pipeline
  (`sync.ts`). **Heads up:** `README.md`'s "Project Structure" section and
  `vitest.config.ts`'s coverage exclude list both still reference the old flat filenames
  (`src/lib/newinmeter-web.ts` etc.) from before this became a subfolder. Those references are
  stale, the code moved, trust the actual file tree over those two spots until someone updates
  them.
- `src/lib/funnel.ts` / `src/lib/funnel-client.ts`: minimal, privacy-conscious onboarding funnel
  (aggregate daily counters only, no user id/session/IP ever stored). The allow-listed event
  types must stay in sync between `FUNNEL_EVENT_TYPES` in `funnel.ts` and the check constraint
  in `supabase/migrations/*_onboarding_funnel*.sql` and `*_funnel_sign_in_method.sql`. If you
  add a new event type, remember that Postgres validates *every existing row* when a check
  constraint is altered (not just new writes), so either keep old values in the allow list
  alongside the new ones, or use `NOT VALID` on the new constraint.
- `src/lib/assistant/`: OpenAI Responses API tool-calling loop. The model never runs arbitrary
  SQL and never executes a mutation directly, every mutating action is a typed proposal the user
  must confirm client-side, re-validated server-side in `/api/assistant/actions`.
- `src/lib/demo/`: the shared public demo account and its protections
  (`DemoAccountProtectedError`, `capabilities.ts`). Never let a demo connection reach real
  LiveMopay credentials, sync, or deletion, this is enforced in multiple places on purpose
  (defense in depth), don't remove a check because it looks redundant with another one.
- Row Level Security scopes every per-connection table to `auth.uid()`. `user_roles` and
  `livemopay_connections` are the two tables without RLS-based access, authorization for those
  is enforced in code (`requireAdminSession`, `getConnectionRowForUser`) via service-role REST
  calls, not by RLS. Don't assume RLS covers everything just because most tables have it.
- Every authenticated API route checks a per-user Upstash rate limit
  (`src/lib/rate-limit.ts`) before doing any work. New routes that do real work (LLM calls,
  LiveMopay network calls, mutations) should follow the same pattern.

## Database

Migrations live in `supabase/migrations`, applied in timestamp order. When adding a migration:

- Match the existing style: a comment block at the top explaining *why*, not just what.
- If altering a `check` constraint on a table with existing rows, remember it validates the
  whole table (see the funnel example above).
- This project uses the Supabase MCP tools for schema inspection and applying migrations in an
  agent session, prefer `list_tables`/`execute_sql` (read-only) over guessing schema shape from
  memory, and treat `apply_migration` as a real production change, not a sandbox action, confirm
  with the user first unless they've already told you to proceed.

## Testing

Coverage is deliberately focused on pure, deterministic logic with real business/money stakes
(`analytics.ts`, `csv.ts`/`export.ts`, `token-encryption.ts`, every assistant tool, alert
dedup/threshold logic), not on thin I/O wrappers or React components in general. The
assistant's rich UI is the one component surface with real `@testing-library/react` tests. Follow
that judgment when deciding whether a new piece of logic needs a test: if it has money, security,
or dedup/threshold stakes, test it; if it's a thin fetch wrapper, it's fine to leave uncovered.

`server-only` is aliased to a no-op stub (`test/stubs/server-only.ts`) in `vitest.config.ts` for
tests, since the real package throws outside a webpack "react-server" bundle.

## Secrets and environment

Never commit `.env.local`. `.env.example` documents every variable, including which are required
for the hosted multi-user setup vs. the legacy single-owner Python CLI vs. optional features
(push notifications, rate limiting). Encrypted values (LiveMopay refresh tokens,
`NEWINMETER_TOKEN_ENCRYPTION_KEY`-encrypted) should never be logged, printed, or included in a
commit, PR description, or chat message, even for debugging, decrypt only in-memory in a
throwaway script and discard the output.

## Deployment

Deploys to Vercel from `main`. Two separate scheduling mechanisms exist, don't confuse them:

- `vercel.json` defines Vercel Cron jobs: `/api/cron/stale-check`, `/api/cron/reset-demo`,
  `/api/cron/cold-storage`, each gated by `CRON_SECRET`.
- `/api/cron/auto-sync` (the every-5-minutes LiveMopay sync scheduler) and the LiveMopay contract
  canary are triggered by **Supabase `pg_cron` + `pg_net`**, not Vercel Cron, see
  `supabase/migrations/20260824000000_newinmeter_auto_sync_schedule.sql`. Changing that cadence
  means editing the Postgres cron schedule, not `vercel.json`.

A schema migration must be applied to the live Supabase project separately from a code deploy,
deploying code that assumes a migration which hasn't been applied yet will fail at runtime (see
the funnel event-type example above for what that looks like).
