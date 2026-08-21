# Legacy ADB Ingestion

This is the original ingestion path from when this project was `livenopay`: a standalone Python
CLI that drives an Android device or emulator over ADB, scrolls the LiveMopay ledger, captures the
screen as UI-hierarchy XML dumps, parses those into electricity/water ledger rows, and syncs them
to Supabase. It predates Supabase Auth, `livemopay_connections`, and the multi-user connection
model entirely -- this whole directory is what used to be the entire repo.

**It is legacy/demo-only, for one account, forever.** It is not used by the deployed multi-user
app (nothing in `src/` imports from here or calls into it), and it is not meant to become
production ingestion again -- it exists so you can demo the original NewinMeter capture approach
(e.g. for a Loom recording) without emulating a browser LiveMopay session.

## Why this needed work before it would run at all

When multi-user support was added, `energy_rows`, `capture_runs`, and the rollup tables all
gained a `NOT NULL connection_id` and their unique keys/PKs were rewritten to lead with it (see
`supabase/migrations/20260725020000_livenopay_enforce_ownership.sql`). This CLI predates that
migration and was never updated for it: it inserted rows with no `connection_id` at all, and its
`ON CONFLICT` target (`charge_label,period_dt,cost,balance`) no longer matched any constraint on
the table. Every insert would have failed outright. `refresh_and_sync.py` now:

- refuses to run until it resolves your target `connection_id` (see below) -- it does not, and
  will never, insert a `connection_id`-less row,
- writes `connection_id` on every `energy_rows`/`capture_runs` row and upserts on
  `connection_id,charge_label,period_dt,cost,balance` (the current unique index), and
- finishes each run through the same `finish_capture_run` RPC the hosted `/api/sync` route calls
  (`src/lib/newinmeter-sync.ts`), so the rollup/dashboard-summary trigger fires exactly as it
  would from a real in-app sync -- there is no separate legacy rollup logic.

It also no longer assumes it lives at a fixed absolute path (the old `livenopay` repo checkout).
Every path here -- `.env.local`, the default data directory, `capture_livemopay.py` from
`refresh_and_sync.py`, `refresh_and_sync.py` from `refresh_with_emulator.sh` -- is resolved from
this file's own location, so it works from a fresh clone regardless of where the repo sits on
disk or what directory you launch it from.

**Incremental capture can look "stuck" if the local CSV cache is stale.** A normal (non-`--full`)
capture dedupes against the local CSV only -- it has no way to know Supabase might already be
current via a different path (the web-API source, or an in-app sync from the hosted dashboard).
If the local file is weeks behind, capture will genuinely find "new" rows for however long that
gap is before it ever hits a stagnant round -- it looks like it never stops, but it's really just
walking a much bigger backlog than expected. `refresh_and_sync.py` now calls
`seed_csv_from_supabase()` before a non-`--full` ADB capture, pulling in whatever Supabase already
has for the target connection so the scroll stops as soon as it reaches genuinely-already-known
data. `--full` skips this on purpose -- it's meant to rebuild from scratch.

`refresh_with_emulator.sh`'s `wait_for_boot` also had two genuinely unbounded `until` loops
polling `getprop sys.boot_completed` / `init.svc.bootanim` -- unlike every other wait in this
codebase (`SCREEN_WAIT_ATTEMPTS`, `MAX_STAGNANT_ROUNDS`, the 90-attempt emulator-detect loop), a
stuck or unusually slow emulator would spin on `sleep 2` forever with no timeout. It's now bounded
by `NEWINMETER_BOOT_WAIT_ATTEMPTS` (default 150 = 5 minutes) and fails loudly
(`EMULATOR_BOOT_TIMEOUT`) instead of hanging.

## Safety model

This script is intentionally hostile to running against the wrong account:

- **`NEWINMETER_LEGACY_TARGET_USER_ID` is required.** Set it in `.env.local` to your own Supabase
  Auth user id. There is no default, no "most recent connection" fallback, and no first-row
  guess.
- **It refuses to run if that doesn't resolve to exactly one connection.** Zero matches, or more
  than one, is a hard `SystemExit` before any capture or write happens.
- **It refuses to write into the demo/recruiter account** (`is_demo = true`), even if you
  mistakenly pointed `NEWINMETER_LEGACY_TARGET_USER_ID` at it.
- **Optional second check:** set `NEWINMETER_LEGACY_TARGET_LIVEMOPAY_EMAIL` and the resolved
  connection's `livemopay_email` must match exactly. This isn't theoretical -- while wiring this
  up, the same LiveMopay login was found connected to *two different* Supabase accounts in this
  project's own database. `user_id` alone already disambiguates the connection row, but this
  catches a copy/pasted wrong id too.
- **It never touches any other table.** Only `capture_runs`, `energy_rows`, and (via the RPC) the
  rollup/`dashboard_summary` tables -- all scoped to the one resolved `connection_id`. It never
  writes `livemopay_connections`, never creates a Supabase Auth user, and never weakens RLS.

## Setup

1. Copy `.env.example` to `.env.local` at the repo root if you haven't already, and fill in
   `SUPABASE_URL` (or reuse `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY`.
2. Find your Supabase Auth user id: Supabase dashboard -> Authentication -> Users -> copy the
   UUID next to your account. Set `NEWINMETER_LEGACY_TARGET_USER_ID` to it in `.env.local`.
3. Optionally set `NEWINMETER_LEGACY_TARGET_LIVEMOPAY_EMAIL` to your LiveMopay login email as a
   second check.
4. For the ADB path: install Android platform tools (`brew install android-platform-tools`) and
   either connect a phone with USB debugging on, or set up an Android emulator with LiveMopay
   installed and logged in -- set `NEWINMETER_AVD_NAME` in `.env.local` to that emulator's AVD
   name. Full walkthrough: [`../../SETUP.md`](../../SETUP.md).

## Commands

Equivalent to the old `livenopay` shell aliases (`lnp-refresh`, `lnp-full`, `lnp-sync`), now run
from this repo instead of a `livenopay` checkout:

```
npm run refresh:emulator                       # normal refresh: launch/attach emulator, capture, sync
npm run refresh:emulator -- --full              # full recapture, rebuilds the ledger from scratch
npm run refresh:emulator -- --skip-capture      # re-sync the existing CSV without touching Android
npm run refresh:emulator -- --no-shutdown       # leave the emulator running afterward
```

Lower-level, without the emulator wrapper (a physical phone, or an already-running emulator):

```
python3 legacy/adb-ingestion/refresh_and_sync.py --source adb
python3 legacy/adb-ingestion/refresh_and_sync.py --source adb --full
python3 legacy/adb-ingestion/refresh_and_sync.py --skip-capture
python3 legacy/adb-ingestion/capture_livemopay.py            # capture only, no Supabase sync
```

The web-API fallback (no Android needed at all) still exists too:

```
python3 legacy/adb-ingestion/refresh_and_sync.py --source web
```

## What each mode does

| Mode | What it does |
| --- | --- |
| normal (`refresh:emulator`) | Launch/attach the emulator, open LiveMopay, scroll+capture new ledger rows since the last capture, sync to Supabase |
| `--full` | Same, but ignores the existing local CSV and rebuilds it by scrolling the entire ledger history from the top |
| `--skip-capture` | Skip Android/ADB entirely; re-sync whatever's already in the local CSV (useful after manually fixing a bad capture) |

After every mode, `finish_capture_run` fires the same rollup-refresh trigger the hosted app uses,
so `energy_day_rollups`, the hourly/interval rollups, and `dashboard_summary` for your connection
are recomputed -- open the dashboard and it reflects the new rows without any extra step.

## Data files

Captured XML dumps, the working CSV, and the capture log default to `legacy/adb-ingestion/data/`
(gitignored). Override with `NEWINMETER_DUMPS_DIR` / `NEWINMETER_CSV_PATH` /
`NEWINMETER_CAPTURE_LOG` in `.env.local` if you want them elsewhere.

## Files

- `capture_livemopay.py` -- drives ADB (tap, scroll, `uiautomator dump`), parses the ledger row
  regexes, writes the local CSV. Unchanged in behavior from the original `livenopay` version,
  only its default data-directory location moved.
- `newinmeter_web.py` -- the web-API fallback (`--source web`): logs into the LiveMopay web
  stack directly instead of driving Android.
- `refresh_and_sync.py` -- orchestrates capture (or `--source web`), resolves the target
  connection, and syncs rows into the current connection-scoped Supabase schema. This is the file
  that was rewritten for the ownership model; the other two are the original capture/parse logic.
- `refresh_with_emulator.sh` -- the `npm run refresh:emulator` wrapper: starts/attaches the
  configured AVD, opens LiveMopay, runs `refresh_and_sync.py --source adb`, shuts the emulator
  down.
- `data/` -- gitignored working directory for XML dumps, the CSV, and the capture log.
