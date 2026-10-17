import { retryTransientSupabaseOperation } from "@/lib/supabase-retry";
import { withRequestBudget } from "@/lib/request-budget";
import { NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/concurrency";
import { getCronSecret } from "@/lib/env";
import { evaluateAlertsAfterSync } from "@/lib/newinmeter/alerts";
import {
  recordSchedulerInvocation,
  reportBroadSyncOutcome,
  reportConnectionReauthenticationRequired,
  reportConnectionSyncFailure,
  reportConnectionSyncSuccess
} from "@/lib/diagnostics/operations";
import {
  claimDueAutoSyncConnections,
  markAutoSyncFailure,
  markAutoSyncSuccess,
  markConnectionAuthError,
  recoverStaleCaptureRuns,
  recoverStaleConnectionRestores,
  releaseAutoSyncClaim,
  replaceConnectionRefreshToken,
  type ClaimedAutoSyncConnection
} from "@/lib/newinmeter/connection";
import { runLivemopaySync, SyncAlreadyRunningError } from "@/lib/newinmeter/sync";
import { LiveMopayRefreshTokenInvalidError } from "@/lib/newinmeter/web";
import { decryptRefreshToken, TokenDecryptionError } from "@/lib/token-encryption";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Allow daily reconciliation to complete, while application deadlines leave
// ten seconds before the platform's hard stop. pg_net already permits 120s.
export const maxDuration = 120;

// Claim one concurrency wave: queued accounts must not inherit an almost
// exhausted invocation. The next five-minute tick handles remaining due work.
const AUTO_SYNC_CLAIM_BATCH_LIMIT = 4;
// How long a claim survives an abandoned worker before another invocation
// may reclaim the same connection. Comfortably longer than any real
// incremental sync takes.
const AUTO_SYNC_CLAIM_TTL_MINUTES = 10;
const CAPTURE_RUN_RECOVERY_TTL_MINUTES = 15;
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

    const sync = await runLivemopaySync({
      connectionId: connection.id,
      accountId: connection.accountId,
      companyId: connection.companyId,
      propertyId: connection.propertyId,
      refreshToken,
      // Automatic syncing always incremental -- see runLivemopaySync's own
      // incremental start-date logic (latest known period_dt). A full
      // history resync stays a manual, user-initiated action only.
      mode: "incremental",
      trigger: "auto",
      onRefreshTokenRotated: (newRefreshToken) => replaceConnectionRefreshToken(connection.id, newRefreshToken)
    });

    if (sync.nextSyncAt) await markAutoSyncSuccess(connection.id, sync.nextSyncAt);
    else await markAutoSyncSuccess(connection.id);
    // Same guaranteed-fresh-rollups reasoning as the manual /api/sync hook;
    // never throws, never affects this connection's outcome either way.
    await evaluateAlertsAfterSync(connection.id, connection.userId);
    await reportConnectionSyncSuccess(connection.id).catch(() => {
      console.error("newinmeter_diagnostics_sync_recovery_failed");
    });
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

    if (error instanceof TokenDecryptionError || error instanceof LiveMopayRefreshTokenInvalidError) {
      // Not retryable -- same reasoning as the manual /api/sync path.
      // markConnectionAuthError flips status out of 'connected' (excluding
      // it from future claims) and clears next_sync_at/sync_claimed_at.
      console.error("newinmeter_auto_sync_auth_error", connection.id, error.message);
      await markConnectionAuthError(connection.id).catch(() => {});
      await reportConnectionReauthenticationRequired(connection.id).catch(() => {
        console.error("newinmeter_diagnostics_reauth_event_failed");
      });
      return "authError";
    }

    const message = error instanceof Error ? error.message : "Automatic sync failed.";
    console.error("newinmeter_auto_sync_failed", connection.id, message);
    await markAutoSyncFailure(connection.id, message).catch(() => {});
    await reportConnectionSyncFailure(connection.id, error).catch(() => {
      console.error("newinmeter_diagnostics_sync_failure_event_failed");
    });
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

  return withRequestBudget(110_000, async () => {
    // Recover runs abandoned by a worker crash or an ambiguous database gateway
    // timeout before attempting new work. Without this, the unique running-run
    // index blocks that connection forever even though its scheduler claim has
    // already expired.
    let setupStage = "recover-runs";
    let recoveredRuns;
    let recoveredRestores;
    let claimed;
    try {
      // Recovery only transitions stale state and is safe to repeat after a
      // lost response. Claims are not: an ambiguous retry could claim a second
      // wave whose first wave would then wait for its lease to expire.
      recoveredRuns = await retryTransientSupabaseOperation(() =>
        recoverStaleCaptureRuns(CAPTURE_RUN_RECOVERY_TTL_MINUTES)
      );
      setupStage = "recover-restores";
      recoveredRestores = await retryTransientSupabaseOperation(() => recoverStaleConnectionRestores(30));
      setupStage = "claim";
      claimed = await claimDueAutoSyncConnections(AUTO_SYNC_CLAIM_BATCH_LIMIT, AUTO_SYNC_CLAIM_TTL_MINUTES);
    } catch (error) {
      // Names and stage identify the failed boundary without logging response
      // bodies, URLs, or a claim payload containing encrypted credentials.
      console.error("newinmeter_scheduler_setup_failed", {
        stage: setupStage,
        errorName: error instanceof Error ? error.name : "Unknown"
      });
      return NextResponse.json({ ok: false, stage: setupStage, retryOnNextTick: true }, { status: 503 });
    }
    if (recoveredRuns.length) {
      console.warn("newinmeter_stale_capture_runs_recovered", recoveredRuns.length);
    }

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

    let heartbeatRecorded = true;
    await Promise.all([
      recordSchedulerInvocation({
        claimed: claimed.length,
        recoveredRuns: recoveredRuns.length,
        recoveredRestores: recoveredRestores.length,
        ...counts
      }).catch((error) => {
        heartbeatRecorded = false;
        console.error("newinmeter_scheduler_heartbeat_failed", {
          errorName: error instanceof Error ? error.name : "Unknown"
        });
      }),
      reportBroadSyncOutcome(counts).catch(() => {
        console.error("newinmeter_broad_sync_health_failed");
      })
    ]);

    return NextResponse.json({
      ok: true,
      heartbeatRecorded,
      claimed: claimed.length,
      recoveredRuns: recoveredRuns.length,
      recoveredRestores: recoveredRestores.length,
      ...counts
    });
  });
}
