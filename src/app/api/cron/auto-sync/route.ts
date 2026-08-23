import { NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getCronSecret } from "@/lib/env";
import {
  claimDueAutoSyncConnections,
  markAutoSyncFailure,
  markAutoSyncSuccess,
  markConnectionAuthError,
  releaseAutoSyncClaim,
  replaceConnectionRefreshToken,
  type ClaimedAutoSyncConnection
} from "@/lib/newinmeter/connection";
import { runLivemopaySync, SyncAlreadyRunningError } from "@/lib/newinmeter/sync";
import { decryptRefreshToken, TokenDecryptionError } from "@/lib/token-encryption";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Bounded batch + bounded concurrency (see below) keeps a single invocation
// well under this even on a cold start; any backlog beyond the batch limit
// is picked up by the next 5-minute pg_cron tick rather than trying to
// drain everything in one request.
export const maxDuration = 60;

// Per-invocation claim size -- separate from AUTO_SYNC_CONCURRENCY below.
// Claiming more than fit in flight at once is fine (they queue behind the
// concurrency limit); claiming everything due at once is not, since a large
// backlog would otherwise all pile onto one worker invocation.
const AUTO_SYNC_CLAIM_BATCH_LIMIT = 10;
// How long a claim survives an abandoned worker before another invocation
// may reclaim the same connection. Comfortably longer than any real
// incremental sync takes.
const AUTO_SYNC_CLAIM_TTL_MINUTES = 10;
// "3 to 5 concurrent" per the design brief -- polite to LiveMopay, not one
// request at a time either.
const AUTO_SYNC_CONCURRENCY = 4;

type Outcome = "success" | "retryable" | "authError" | "alreadyRunning";

async function processClaimedConnection(connection: ClaimedAutoSyncConnection): Promise<Outcome> {
  try {
    const refreshToken = decryptRefreshToken({
      ciphertext: connection.refreshTokenCiphertext,
      iv: connection.refreshTokenIv,
      authTag: connection.refreshTokenAuthTag
    });

    await runLivemopaySync({
      connectionId: connection.id,
      accountId: connection.accountId,
      companyId: connection.companyId,
      propertyId: connection.propertyId,
      refreshToken,
      // Automatic syncing always incremental -- see runLivemopaySync's own
      // incremental start-date logic (latest known period_dt). A full
      // history resync stays a manual, user-initiated action only.
      mode: "incremental",
      onRefreshTokenRotated: (newRefreshToken) => replaceConnectionRefreshToken(connection.id, newRefreshToken)
    });

    await markAutoSyncSuccess(connection.id);
    return "success";
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      // A manual refresh (or another automatic attempt) already holds the
      // real capture_runs lock for this connection -- not this connection's
      // fault. Release the scheduler claim; next_sync_at is untouched, so
      // the next tick (or the in-flight sync finishing) resolves it.
      await releaseAutoSyncClaim(connection.id).catch(() => {});
      return "alreadyRunning";
    }

    if (error instanceof TokenDecryptionError) {
      // Not retryable -- same reasoning as the manual /api/sync path.
      // markConnectionAuthError flips status out of 'connected' (excluding
      // it from future claims) and clears next_sync_at/sync_claimed_at.
      console.error("newinmeter_auto_sync_auth_error", connection.id, error.message);
      await markConnectionAuthError(connection.id).catch(() => {});
      return "authError";
    }

    const message = error instanceof Error ? error.message : "Automatic sync failed.";
    console.error("newinmeter_auto_sync_failed", connection.id, message);
    await markAutoSyncFailure(connection.id, message).catch(() => {});
    return "retryable";
  }
}

// Invoked every 5 minutes by Supabase pg_cron (via pg_net -> this route --
// see the auto-sync-schedule migration), never by a browser. This is the
// only place that actually contacts LiveMopay on a schedule: pg_cron itself
// never runs per-user, it just ticks this one lightweight endpoint, which
// atomically claims a small due batch and dispatches it with bounded
// concurrency through the existing runLivemopaySync() pipeline. One
// claimed connection failing never aborts the rest of the batch.
export async function POST(request: Request) {
  const expected = getCronSecret();
  const provided = request.headers.get("authorization");
  if (provided !== `Bearer ${expected}`) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const claimed = await claimDueAutoSyncConnections(AUTO_SYNC_CLAIM_BATCH_LIMIT, AUTO_SYNC_CLAIM_TTL_MINUTES);

  const results = await mapWithConcurrency(claimed, AUTO_SYNC_CONCURRENCY, processClaimedConnection);

  const counts = { success: 0, retryable: 0, authError: 0, alreadyRunning: 0, unexpected: 0 };
  for (const result of results) {
    if (result.status === "fulfilled") {
      counts[result.value] += 1;
    } else {
      // processClaimedConnection catches everything itself, so this should
      // be unreachable -- kept only so one truly unexpected throw still
      // can't take down the response.
      console.error("newinmeter_auto_sync_unexpected", result.reason);
      counts.unexpected += 1;
    }
  }

  return NextResponse.json({ ok: true, claimed: claimed.length, ...counts });
}
