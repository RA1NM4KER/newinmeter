# Live electricity — operations & verification

Reference for verifying the Live subsystem's security and reliability boundaries
that cannot be fully covered by the automated unit/integration suite (they need
two real authenticated users, real WebSockets, or the production database).

## Architecture (one line each)

```
Arduino → Mac bridge → POST /api/live/pulses (device-key auth)
  → meter_pulses (idempotent on device_id+boot_id+seq)
  → best-effort private Broadcast: live-meter:<owner-user-id> / pulses_changed
Browser /live → GET /api/live/overview (session auth, feature-gated)
  → live_meter_overview RPC (one snapshot) → pure TS calc → typed JSON
  → React Query (60s fallback) + private Realtime subscription (invalidate-only)
```

## Realtime authorization (RLS) — two-user manual verification

The `realtime.messages` SELECT policy (`live_meter_owner_receive_broadcast`,
migration `20260807030000`) restricts broadcast receipt to
`realtime.topic() = 'live-meter:' || auth.uid()`. There is no INSERT policy, so
browsers can only receive. Automated cross-user socket tests would require
creating two production auth users, so verify manually:

1. Sign in as User A (has `live_meter_enabled`). Open `/live`. DevTools → Network
   → WS: confirm the realtime socket subscribes to `live-meter:<A-uid>` and
   reaches `SUBSCRIBED`.
2. In the console, try to subscribe to another user's topic:
   ```js
   const ch = window.supabase /* if exposed */ ?? null; // otherwise use the app client
   ```
   Practically: attempt `supabase.channel('live-meter:<B-uid>', { config: { private: true } }).subscribe(cb)`
   — the callback must NOT reach `SUBSCRIBED` (authorization is denied); no
   `pulses_changed` events for B may arrive.
3. Trigger a real pulse batch for B (B's bridge). Confirm A receives nothing.
4. Repeat 1–3 with roles swapped.
5. Sign in as User C with `live_meter_enabled = false`: `/live` must 404 and
   `GET /api/live/overview` must 404. Manually constructing
   `live-meter:<C-uid>` must not deliver events (C has no device and the policy
   still only permits C's own topic — which never receives broadcasts).
6. Unauthenticated client: `GET /api/live/overview` → 401; a private channel
   subscription without a valid JWT must not reach `SUBSCRIBED`.

DB-level spot check of the policy (read-only, via SQL editor / service role):

```sql
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'realtime.messages'::regclass;
-- Expect exactly the live-meter SELECT policy scoped to auth.uid(); no USING(true).
```

## Service-role never in the client bundle

After `npm run build`:

```sh
KEY=$(grep -oE 'SUPABASE_SERVICE_ROLE_KEY=.*' .env.local | cut -d= -f2-)
grep -rl -- "$KEY" .next/static           # must print nothing
grep -rl "SERVICE_ROLE\|live_meter_overview\|realtime/v1/api/broadcast" .next/static  # nothing
```

## Ingestion / overview observability

Structured JSON error lines (category = `evt`), all secret-redacted:

- `live_ingest_auth_error` — device-auth lookup failed (transient) → 503
- `live_ingest_error` — feature/rate-limit check failed → 503
- `live_ingest_db_error` — pulse insert failed → 500 (`deviceId`, `reqId`)
- `live_broadcast_failed` — best-effort Realtime nudge failed (warn; ingestion still 200)
- `live_overview_error` — overview RPC/read failed → 500 (`reqId`, `window`)

Never logged: raw device keys, `api_key_hash`, bearer tokens, access tokens,
LiveMopay credentials (see `redact()` + its tests).

## Local soak / chaos procedure (no synthetic production data)

Run the bridge against the real Arduino (or a local dev Supabase project with
its own test device — never write synthetic rows to production). Exercise:

1. **Normal run (30+ min):** one overview refetch per real batch (~5s while
   pulses flow), not a fixed poll. Graph steady when load is steady.
2. **Realtime disconnect/reconnect:** DevTools → Network → throttle "Offline"
   ~30s, then online. Socket rejoins (`SUBSCRIBED`), one recovery refetch fires,
   no duplicate request storm.
3. **Tab close/reopen & refresh:** channel cleaned up on unmount (no leaked
   sockets in Network); reopen re-subscribes cleanly.
4. **Duplicate ingestion:** replay an identical batch (same bootId+seqs) → API
   returns `duplicates>0, accepted=0`; no new rows; no broadcast; totals stable.
5. **Broadcast failure:** temporarily point `SUPABASE_URL`'s realtime endpoint
   at an invalid host in a dev run → ingestion still returns 200; overview still
   updates via the 60s fallback; a `live_broadcast_failed` warn appears.
6. **DB error path (dev only):** revoke the RPC/select in a dev DB → overview
   returns 500 with `live_overview_error`; the page keeps the last good data and
   shows the "temporarily unavailable" status (no zeros).
7. **Low/high pulse frequency:** slow load → estimate stays fresh within the 10s
   floor; fast load → hero tracks; never shows 0 W for silence.
8. **Bridge/Arduino reboot:** reset the Uno → new bootId; seq restarts; no
   duplicate errors; graph continues.

## What to inspect in Supabase

- `select count(*) from meter_pulses where device_id = '<id>'` grows only with
  real flashes; retries never inflate it (unique constraint).
- `meter_devices.last_seen_at` advances after each accepted batch.
- Logs: the `evt` categories above are greppable and secret-free.
