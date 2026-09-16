import "server-only";

import { randomUUID } from "node:crypto";
import { adminSupabaseFetch, adminSupabaseRequest } from "../supabase-rest";
import {
  currentNewinmeterLocalYear,
  dedupeNewinmeterRows,
  fetchLiveMopayLedger,
  isRefundLabel,
  newinmeterLedgerKey,
  refreshLiveMopaySession,
  type NewinmeterCsvRow
} from "./web";
import { resolveTariffBand } from "./tariff-profiles";

const BATCH_SIZE = 500;

export type SyncMode = "incremental" | "full" | "restore";
export type SyncTrigger = "manual" | "auto" | "restore";

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super("A sync is already running for this connection.");
    this.name = "SyncAlreadyRunningError";
  }
}

type CaptureRunRow = { id: string; status: "running" | "success" | "failed" };

const TRANSIENT_SUPABASE_RETRY_ATTEMPTS = 3;
const TRANSIENT_SUPABASE_RETRY_DELAY_MS = 250;

// A gateway timeout is ambiguous: PostgREST may have completed the statement
// even though the caller did not receive its response. Only use retries for
// operations that are naturally idempotent, or after reconciling their state.
function isTransientSupabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(502|503|504)\b|gateway timeout|fetch failed|network/i.test(message);
}

async function retryTransientSupabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < TRANSIENT_SUPABASE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientSupabaseError(error) || attempt === TRANSIENT_SUPABASE_RETRY_ATTEMPTS - 1) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_SUPABASE_RETRY_DELAY_MS * 2 ** attempt));
    }
  }

  throw lastError;
}

export type LivemopaySyncParams = {
  connectionId: string;
  accountId: string;
  companyId: string;
  propertyId: string;
  refreshToken: string;
  mode: SyncMode;
  trigger: SyncTrigger;
  onRefreshTokenRotated: (newRefreshToken: string) => Promise<void>;
};

export function recentRestoreStartDate(now = new Date()) {
  return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

async function latestPeriodDateForConnection(connectionId: string) {
  const rows = await retryTransientSupabaseOperation(() =>
    adminSupabaseFetch<Array<{ period_dt: string }>>(
      `/energy_rows?select=period_dt&connection_id=eq.${encodeURIComponent(connectionId)}&order=period_dt.desc&limit=1`
    )
  );

  return rows[0]?.period_dt?.split(" ", 1)[0] || null;
}

async function startCaptureRun(connectionId: string, mode: SyncMode, trigger: SyncTrigger) {
  // Supplying the id ourselves makes an ambiguous POST safely reconcilable.
  // A retry can then discover this exact run instead of accidentally creating
  // a second one (or mistaking the partial unique-index conflict for another
  // worker's active sync).
  const runId = randomUUID();
  try {
    const response = await adminSupabaseRequest<CaptureRunRow[]>("POST", "/rpc/start_capture_run", {
      p_run_id: runId,
      p_connection_id: connectionId,
      p_mode: mode,
      p_trigger: trigger
    });

    return response[0]?.id ?? runId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // capture_runs_one_running_per_connection is a partial unique index on
    // (connection_id) where status = 'running' -- this is the DB-level
    // concurrency guard replacing the old in-memory `activeSync` variable.
    if (message.includes("23505") || message.includes("duplicate key")) {
      throw new SyncAlreadyRunningError();
    }

    if (isTransientSupabaseError(error)) {
      const existing = await retryTransientSupabaseOperation(() =>
        adminSupabaseFetch<CaptureRunRow[]>(`/capture_runs?select=id,status&id=eq.${encodeURIComponent(runId)}&limit=1`)
      );
      if (existing[0]) {
        return runId;
      }
    }

    throw error;
  }
}

async function finishCaptureRun(
  runId: string,
  status: "success" | "failed",
  options: { rowsSynced?: number; error?: string } = {}
) {
  // Routed through the finish_capture_run RPC (not a plain PATCH) so it can
  // raise statement_timeout for itself before the UPDATE -- and its
  // cascading rollup-refresh trigger -- begins executing. See
  // supabase/migrations/20260726030000_newinmeter_finish_capture_run_rpc.sql.
  const finalize = () =>
    adminSupabaseRequest(
      "POST",
      "/rpc/finish_capture_run",
      {
        p_run_id: runId,
        p_status: status,
        p_rows_synced: options.rowsSynced ?? null,
        p_error: options.error ?? null
      },
      "return=minimal"
    );

  try {
    await finalize();
  } catch (error) {
    if (!isTransientSupabaseError(error)) throw error;

    // Do not turn a successfully finalized run into a failure merely because
    // its response was lost. The RPC's conditional transition (migration
    // 20260912000000) makes a same-status retry safe as well.
    const existing = await retryTransientSupabaseOperation(() =>
      adminSupabaseFetch<CaptureRunRow[]>(`/capture_runs?select=id,status&id=eq.${encodeURIComponent(runId)}&limit=1`)
    );
    if (existing[0]?.status === status) return;
    if (existing[0] && existing[0].status !== "running") {
      throw new Error(`Capture run was already finalized as ${existing[0].status}.`);
    }

    await retryTransientSupabaseOperation(finalize);

    const reconciled = await retryTransientSupabaseOperation(() =>
      adminSupabaseFetch<CaptureRunRow[]>(`/capture_runs?select=id,status&id=eq.${encodeURIComponent(runId)}&limit=1`)
    );
    if (reconciled[0]?.status !== status) {
      throw new Error("Capture run finalization could not be confirmed.");
    }
  }
}

// A fingerprint of what the OLD parser would have written for a ledger entry
// that LiveMopay now reports as a refund. Every field is reconstructed from the
// current authoritative fetch and is identical between the two parsers for the
// same entry:
//   - source_ts: the ledger entry's own timestamp, copied verbatim by both.
//   - cost: the old "Top Up" stored the positive credit; the new refund stores
//     its negative, so the old value is abs(new cost).
//   - balance / period_dt: both parsers derive these the same way (balanceIncl,
//     and captureDateToPeriodDate(capture_dt) for a credit row).
// Matching on all four -- not source_ts alone -- means a timestamp collision
// with a genuine wallet top-up (different amount/balance) can never match.
export type RefundTopupMatcher = {
  sourceTs: string;
  cost: string;
  balance: string;
  periodDt: string;
};

function absMoney(value: string) {
  return value.startsWith("-") ? value.slice(1) : value;
}

export function refundTopupMatchers(rows: NewinmeterCsvRow[]): RefundTopupMatcher[] {
  const seen = new Set<string>();
  const matchers: RefundTopupMatcher[] = [];

  for (const row of rows) {
    if (!isRefundLabel(row.charge_label)) {
      continue;
    }

    const sourceTs = row.source_ts.trim();
    // Rows with no source_ts (legacy captures) can't be positively linked to an
    // API entry, so they are never eligible for cleanup.
    if (!sourceTs) {
      continue;
    }

    const matcher: RefundTopupMatcher = {
      sourceTs,
      cost: absMoney(row.cost.trim()),
      balance: row.balance.trim(),
      periodDt: row.period_dt.trim()
    };

    const key = `${matcher.sourceTs}|${matcher.cost}|${matcher.balance}|${matcher.periodDt}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    matchers.push(matcher);
  }

  return matchers;
}

// Builds the PostgREST DELETE path that removes ONLY rows the old parser
// mislabelled "Top Up" which LiveMopay now reports as a refund. Each refund
// contributes an and(...) group pinning source_ts AND cost AND balance AND
// period_dt together, so a row is deleted only when it matches a confirmed
// refund on every one of those values -- a shared source_ts alone is never
// enough. Returns null when there is nothing to do, so the caller skips the
// request entirely (never issues an unfiltered delete). The path always targets
// /energy_rows -- never usage_activities or any other user-owned table.
export function buildRefundTopupDeletePath(connectionId: string, matchers: RefundTopupMatcher[]) {
  if (!matchers.length) {
    return null;
  }

  const orValue =
    "(" +
    matchers
      .map(
        (m) =>
          `and(source_ts.eq."${m.sourceTs}",cost.eq.${m.cost},balance.eq.${m.balance},period_dt.eq."${m.periodDt}")`
      )
      .join(",") +
    ")";

  return (
    `/energy_rows?connection_id=eq.${encodeURIComponent(connectionId)}` +
    `&charge_label=eq.${encodeURIComponent("Top Up")}` +
    `&or=${encodeURIComponent(orValue)}` +
    `&select=id`
  );
}

// Removes the stale "Top Up" twins of refunds that the current sync re-parsed
// correctly. Conservative by construction: no loose heuristics -- a row is
// deleted only when it matches a confirmed refund from the authoritative fetch
// on source_ts, cost, balance and period_dt together. Returns the number of
// rows removed.
async function deleteMisparsedRefundTopups(connectionId: string, matchers: RefundTopupMatcher[]) {
  const path = buildRefundTopupDeletePath(connectionId, matchers);
  if (!path) {
    return 0;
  }

  const removed = await retryTransientSupabaseOperation(() =>
    adminSupabaseRequest<Array<{ id: string }>>("DELETE", path, undefined, "return=representation")
  );

  return removed.length;
}

export function buildEnergyRowsUpsertBatch(
  connectionId: string,
  rows: NewinmeterCsvRow[],
  runId: string,
  tariffProfile: string | null,
  syncedAt: string
) {
  const batchSeen = new Set<string>();
  return dedupeNewinmeterRows(rows).flatMap((row) => {
    const key = newinmeterLedgerKey(row);
    if (batchSeen.has(key)) return [];
    batchSeen.add(key);
    const sourceTs = row.source_ts.trim();
    return [
      {
        connection_id: connectionId,
        capture_dt: row.capture_dt,
        charge_label: row.charge_label,
        tariff_band: resolveTariffBand({
          kind: row.charge_label.trim().toLowerCase().startsWith("water:") ? "water" : "energy",
          chargeLabel: row.charge_label,
          tariffProfile,
          periodDate: row.period_dt,
          tariff: row.tariff
        }),
        period_dt: row.period_dt,
        kwh: row.kwh,
        water_kl: row.water_kl,
        tariff: row.tariff,
        cost: row.cost,
        balance: row.balance,
        source_ts: sourceTs || null,
        sync_run_id: runId,
        last_seen_at: syncedAt
      }
    ];
  });
}

async function upsertRows(connectionId: string, rows: NewinmeterCsvRow[], runId: string) {
  const syncedAt = nowIso();
  const onConflict = encodeURIComponent("connection_id,charge_label,period_dt,cost,balance");
  const connectionRows = await retryTransientSupabaseOperation(() =>
    adminSupabaseFetch<Array<{ tariff_profile: string | null }>>(
      `/livemopay_connections?select=tariff_profile&id=eq.${encodeURIComponent(connectionId)}&limit=1`
    )
  );
  const tariffProfile = connectionRows[0]?.tariff_profile ?? null;
  let total = 0;

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = buildEnergyRowsUpsertBatch(
      connectionId,
      rows.slice(index, index + BATCH_SIZE),
      runId,
      tariffProfile,
      syncedAt
    );

    if (!batch.length) {
      continue;
    }

    await retryTransientSupabaseOperation(() =>
      adminSupabaseRequest(
        "POST",
        `/energy_rows?on_conflict=${onConflict}`,
        batch,
        "resolution=merge-duplicates,return=minimal"
      )
    );

    total += batch.length;
  }

  return total;
}

// No CSV intermediate: ledger rows go straight from LiveMopay into Supabase.
// Id tokens are never persisted, so every sync starts by refreshing the
// LiveMopay session from the connection's stored (encrypted) refresh token.
export async function runLivemopaySync(params: LivemopaySyncParams) {
  const runId = await startCaptureRun(params.connectionId, params.mode, params.trigger);
  if (!runId) {
    throw new Error("Failed to create capture run.");
  }

  try {
    const session = await refreshLiveMopaySession(params.refreshToken);

    if (session.refreshToken !== params.refreshToken) {
      await params.onRefreshTokenRotated(session.refreshToken);
    }

    const startDate =
      params.mode === "full"
        ? "2000-01-01"
        : params.mode === "restore"
          ? recentRestoreStartDate()
          : (await latestPeriodDateForConnection(params.connectionId)) || `${currentNewinmeterLocalYear()}-01-01`;

    const rows = await fetchLiveMopayLedger({
      idToken: session.idToken,
      accountId: params.accountId,
      companyId: params.companyId,
      propertyId: params.propertyId,
      startDate
    });

    // Remove any stale "Top Up" rows that the old parser mislabelled but
    // LiveMopay now reports as refunds, before inserting the corrected refund
    // rows. Only touches energy_rows; user-owned Activities are untouched.
    const removedStaleRefunds = await deleteMisparsedRefundTopups(params.connectionId, refundTopupMatchers(rows));

    const synced = await upsertRows(params.connectionId, rows, runId);
    await finishCaptureRun(runId, "success", { rowsSynced: synced });

    const cleanupNote =
      removedStaleRefunds > 0 ? ` Removed ${removedStaleRefunds} stale mis-parsed refund row(s).` : "";

    return {
      mode: params.mode,
      output: `Fetched ${rows.length} rows from LiveMopay. Synced ${synced} rows to Supabase.${cleanupNote}`,
      rowsSynced: synced
    };
  } catch (error) {
    try {
      await finishCaptureRun(runId, "failed", { error: error instanceof Error ? error.message : String(error) });
    } catch (finalizeError) {
      // Preserve the original cause. The stale-run recovery job will close an
      // inconclusive failure after its lease expires instead of leaving the
      // connection locked forever.
      console.error("newinmeter_capture_run_failure_finalize_inconclusive", runId, finalizeError);
    }
    throw error;
  }
}
