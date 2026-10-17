import "server-only";

import { getNewinmeterWebBaseUrl } from "../env";
import { checkRequestBudget, withRequestBudget } from "../request-budget";
import { isTransientSupabaseError, retryTransientSupabaseOperation } from "../supabase-retry";
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
import { observeReporting, reconciliationStartDate } from "./adaptive-schedule";
import {
  buildElectricityObservation,
  electricitySchedule,
  electricityScopeKey,
  type ElectricityObservation
} from "./electricity-availability";
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
  syncedAt: string,
  correctionCandidates: ReadonlySet<string> = new Set()
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
        last_seen_at: syncedAt,
        reconcile_key: correctionCandidates.has(ledgerEventKey(row))
      }
    ];
  });
}

function ledgerEventKey(row: NewinmeterCsvRow) {
  return JSON.stringify([row.source_ts.trim(), row.charge_label.trim(), row.period_dt.trim()]);
}

export function ledgerCorrectionCandidates(rows: NewinmeterCsvRow[]): ReadonlySet<string> {
  const events = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.source_ts.trim() || !Number.isFinite(Date.parse(row.source_ts))) continue;
    const event = ledgerEventKey(row);
    const keys = events.get(event) ?? new Set<string>();
    keys.add(newinmeterLedgerKey(row));
    events.set(event, keys);
  }
  // Determine uniqueness across the entire authoritative response, before
  // splitting it into database batches. Conflicting incoming variants of the
  // same event are retained for investigation, never guessed away.
  return new Set(
    Array.from(events)
      .filter(([, keys]) => keys.size === 1)
      .map(([event]) => event)
  );
}

async function upsertRows(connectionId: string, rows: NewinmeterCsvRow[], runId: string, forceRefresh = false) {
  const syncedAt = nowIso();
  const connectionRows = await retryTransientSupabaseOperation(() =>
    adminSupabaseFetch<Array<{ tariff_profile: string | null }>>(
      `/livemopay_connections?select=tariff_profile&id=eq.${encodeURIComponent(connectionId)}&limit=1`
    )
  );
  const tariffProfile = connectionRows[0]?.tariff_profile ?? null;
  const correctionCandidates = ledgerCorrectionCandidates(rows);
  let total = 0;

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    checkRequestBudget();
    const batch = buildEnergyRowsUpsertBatch(
      connectionId,
      rows.slice(index, index + BATCH_SIZE),
      runId,
      tariffProfile,
      syncedAt,
      correctionCandidates
    );

    if (!batch.length) {
      continue;
    }

    const started = Date.now();
    const batchNumber = Math.floor(index / BATCH_SIZE) + 1;
    console.info("newinmeter_sync_batch", {
      connectionId,
      runId,
      batch: batchNumber,
      rows: batch.length,
      event: "started"
    });
    total += await retryTransientSupabaseOperation(() =>
      adminSupabaseRequest<number>("POST", "/rpc/upsert_changed_energy_rows", {
        p_connection_id: connectionId,
        p_run_id: runId,
        p_rows: batch,
        p_force_refresh: forceRefresh
      })
    );
    console.info("newinmeter_sync_batch", {
      connectionId,
      runId,
      batch: batchNumber,
      event: "finished",
      durationMs: Date.now() - started
    });
  }

  return total;
}

// No CSV intermediate: ledger rows go straight from LiveMopay into Supabase.
// Id tokens are never persisted, so every sync starts by refreshing the
// LiveMopay session from the connection's stored (encrypted) refresh token.
export async function runLivemopaySync(params: LivemopaySyncParams) {
  let runId: string | undefined;
  let electricityObservation: ElectricityObservation | null = null;
  let observationRecorded = false;
  const stage = async <T>(
    name: string,
    operation: () => Promise<T>,
    fields: Record<string, number | string | boolean> = {}
  ): Promise<T> => {
    const started = Date.now();
    console.info("newinmeter_sync_stage", {
      connectionId: params.connectionId,
      runId,
      stage: name,
      event: "started",
      ...fields
    });
    try {
      const value = await operation();
      console.info("newinmeter_sync_stage", {
        connectionId: params.connectionId,
        runId,
        stage: name,
        event: "finished",
        durationMs: Date.now() - started,
        ...fields
      });
      return value;
    } catch (error) {
      console.warn("newinmeter_sync_stage", {
        connectionId: params.connectionId,
        runId,
        stage: name,
        event: "failed",
        durationMs: Date.now() - started,
        errorName: error instanceof Error ? error.name : "Unknown",
        ...fields
      });
      throw error;
    }
  };
  const work = async () => {
    runId = await stage("start", () => startCaptureRun(params.connectionId, params.mode, params.trigger));
    if (!runId) throw new Error("Failed to create capture run.");
    const activeRunId = runId;

    const session = await stage("session", () => refreshLiveMopaySession(params.refreshToken));

    if (session.refreshToken !== params.refreshToken) {
      await stage("token-persistence", () => params.onRefreshTokenRotated(session.refreshToken));
    }

    const [scheduleState] = await stage("schedule-state", () =>
      adminSupabaseFetch<
        Array<{
          reporting_model: unknown;
          sync_schedule_mode: "shadow" | "adaptive";
          last_reconciled_at: string | null;
          auto_sync_enabled: boolean;
          is_demo: boolean;
          data_state: string;
          next_sync_at: string | null;
          auto_sync_failure_streak: number;
        }>
      >(
        `/livemopay_connections?select=reporting_model,sync_schedule_mode,last_reconciled_at,auto_sync_enabled,is_demo,data_state,next_sync_at,auto_sync_failure_streak&id=eq.${encodeURIComponent(params.connectionId)}&limit=1`
      )
    );
    const reconciliation =
      params.mode === "incremental" && scheduleState?.sync_schedule_mode === "adaptive"
        ? reconciliationStartDate(scheduleState?.last_reconciled_at ?? null)
        : null;
    const startDate =
      params.mode === "full"
        ? "2000-01-01"
        : params.mode === "restore"
          ? recentRestoreStartDate()
          : (reconciliation ??
            (await latestPeriodDateForConnection(params.connectionId)) ??
            `${currentNewinmeterLocalYear()}-01-01`);

    const fetchStartedAt = nowIso();
    let parserComplete = false;
    const rows = await stage(
      "ledger",
      () =>
        fetchLiveMopayLedger({
          idToken: session.idToken,
          accountId: params.accountId,
          companyId: params.companyId,
          propertyId: params.propertyId,
          startDate,
          onParsedResponse: (facts) => {
            parserComplete = facts.skippedRows === 0;
          }
        }),
      { reconciliation: Boolean(reconciliation), startDate }
    );

    const fetchFinishedAt = nowIso();
    if (
      scheduleState?.sync_schedule_mode === "adaptive" &&
      scheduleState.is_demo === false &&
      scheduleState.data_state === "warm" &&
      params.trigger !== "restore"
    ) {
      try {
        electricityObservation = buildElectricityObservation({
          rows,
          scopeKey: electricityScopeKey([
            getNewinmeterWebBaseUrl(),
            params.accountId,
            params.companyId,
            params.propertyId
          ]),
          fetchStartedAt,
          fetchFinishedAt,
          startDate,
          trigger: params.trigger,
          reconciliation: Boolean(reconciliation),
          autoSyncEnabled: scheduleState.auto_sync_enabled,
          parserComplete,
          schedule: electricitySchedule({
            model: scheduleState.reporting_model,
            mode: scheduleState.sync_schedule_mode,
            dueAt: scheduleState.next_sync_at ?? null,
            trigger: params.trigger,
            httpFailureStreak: scheduleState.auto_sync_failure_streak ?? 0
          })
        });
      } catch {
        // Measurement must never become a new ingestion failure mode.
        console.warn("newinmeter_availability_build_failed");
      }
    }

    // Remove any stale "Top Up" rows that the old parser mislabelled but
    // LiveMopay now reports as refunds, before inserting the corrected refund
    // rows. Only touches energy_rows; user-owned Activities are untouched.
    const removedStaleRefunds = await stage("refund-cleanup", () =>
      deleteMisparsedRefundTopups(params.connectionId, refundTopupMatchers(rows))
    );

    const synced = await stage(
      "upsert",
      () => upsertRows(params.connectionId, rows, activeRunId, removedStaleRefunds > 0),
      { rows: rows.length, batches: Math.ceil(rows.length / BATCH_SIZE) }
    );
    const decisionAt = new Date();
    const model = observeReporting(scheduleState?.reporting_model, rows, params.connectionId, decisionAt);
    if (electricityObservation)
      electricityObservation.nextDecision = electricitySchedule({
        model,
        mode: scheduleState!.sync_schedule_mode,
        dueAt: model.predictedAt,
        trigger: "auto",
        httpFailureStreak: 0,
        decisionAt
      });
    const recorded = await stage("capture-metadata", () =>
      adminSupabaseRequest<boolean | null>("POST", "/rpc/record_capture_metadata", {
        p_run_id: activeRunId,
        p_metadata: {
          rows_fetched: rows.length,
          rows_changed: synced + removedStaleRefunds,
          upstream_latest_at: model.latestPublicationAt,
          predicted_next_at: model.predictedAt
        },
        p_observation: electricityObservation
      })
    );
    observationRecorded = recorded === true;
    if (electricityObservation && recorded === false) console.warn("newinmeter_availability_not_recorded");
    await stage("finalize", () => finishCaptureRun(activeRunId, "success", { rowsSynced: synced }));
    await stage("connection-metadata", () =>
      adminSupabaseRequest(
        "PATCH",
        `/livemopay_connections?id=eq.${encodeURIComponent(params.connectionId)}`,
        {
          reporting_model: model,
          ...(params.trigger === "manual" &&
          scheduleState?.sync_schedule_mode === "adaptive" &&
          scheduleState.auto_sync_enabled
            ? { next_sync_at: model.predictedAt }
            : {}),
          ...(reconciliation || params.mode !== "incremental" ? { last_reconciled_at: nowIso() } : {})
        },
        "return=minimal"
      )
    );

    const cleanupNote =
      removedStaleRefunds > 0 ? ` Removed ${removedStaleRefunds} stale mis-parsed refund row(s).` : "";

    return {
      mode: params.mode,
      output: `Fetched ${rows.length} rows from LiveMopay. Synced ${synced} rows to Supabase.${cleanupNote}`,
      rowsSynced: synced,
      rowsFetched: rows.length,
      rowsChanged: synced + removedStaleRefunds,
      nextSyncAt: scheduleState?.sync_schedule_mode === "adaptive" ? model.predictedAt : null
    };
  };
  try {
    // Manual/full/restore callers retain their existing execution policy.
    return await (params.trigger === "auto" ? withRequestBudget(90_000, work) : work());
  } catch (error) {
    if (!runId) throw error;
    const failedRunId = runId;
    try {
      const cleanup = () =>
        finishCaptureRun(failedRunId, "failed", { error: error instanceof Error ? error.message : String(error) });
      await stage("failure-cleanup", () =>
        params.trigger === "auto" ? withRequestBudget(10_000, cleanup) : cleanup()
      );
    } catch (finalizeError) {
      // Preserve the original cause. The stale-run recovery job will close an
      // inconclusive failure after its lease expires instead of leaving the
      // connection locked forever.
      console.error("newinmeter_capture_run_failure_finalize_inconclusive", runId, finalizeError);
    }
    // Finalize/release first. A fetched response is still valid evidence if
    // ledger ingestion failed, but recording it must not consume cleanup time.
    if (electricityObservation && !observationRecorded) {
      try {
        const recorded = await withRequestBudget(1000, () =>
          adminSupabaseRequest<boolean>("POST", "/rpc/record_capture_metadata", {
            p_run_id: failedRunId,
            p_metadata: null,
            p_observation: electricityObservation
          })
        );
        if (!recorded) console.warn("newinmeter_availability_not_recorded");
      } catch {
        console.warn("newinmeter_availability_not_recorded");
      }
    }
    throw error;
  }
}
