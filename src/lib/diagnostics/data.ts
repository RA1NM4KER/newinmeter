import "server-only";

import { countPushSubscriptions } from "../push-subscriptions";
import { adminSupabaseFetch } from "../supabase-rest";
import { listAllAuthUsers } from "../user-roles";
import {
  classifyCanaryHealth,
  classifyConnectionHealth,
  classifySchedulerHealth,
  worstHealthState,
  type HealthState
} from "./health";
import {
  getSystemHealthStates,
  listRecentSystemEvents,
  listUnresolvedSystemEvents,
  sanitizeDiagnosticMessage
} from "./store";

export const DIAGNOSTIC_CONNECTION_SELECT =
  "id,user_id,account_label,status,connected_at,last_synced_at,last_error,auto_sync_enabled,next_sync_at," +
  "last_auto_sync_at,last_auto_sync_status,last_auto_sync_error,sync_claimed_at";

type DiagnosticConnectionRow = {
  id: string;
  user_id: string;
  account_label: string | null;
  status: "connected" | "pending_selection" | "disconnected" | "error";
  connected_at: string;
  last_synced_at: string | null;
  last_error: string | null;
  auto_sync_enabled: boolean;
  next_sync_at: string | null;
  last_auto_sync_at: string | null;
  last_auto_sync_status: "success" | "failed" | null;
  last_auto_sync_error: string | null;
  sync_claimed_at: string | null;
};

type CaptureRunRow = {
  id: string;
  connection_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed";
  mode: "incremental" | "full";
  trigger: "unknown" | "manual" | "auto";
  rows_synced: number | null;
  error: string | null;
};

export type DiagnosticSyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: CaptureRunRow["status"];
  mode: CaptureRunRow["mode"];
  trigger: CaptureRunRow["trigger"];
  rowsSynced: number | null;
  error: string | null;
};

export type DiagnosticConnection = {
  id: string;
  userEmail: string | null;
  accountLabel: string | null;
  status: DiagnosticConnectionRow["status"];
  health: HealthState;
  healthReason: string;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: CaptureRunRow["status"] | null;
  lastError: string | null;
  lastAutoSyncAt: string | null;
  lastAutoSyncStatus: "success" | "failed" | null;
  lastAutoSyncError: string | null;
  nextSyncAt: string | null;
  syncClaimedAt: string | null;
  claimStuck: boolean;
  stale: boolean;
  consecutiveFailures: number;
  recentRuns: DiagnosticSyncRun[];
};

export type DiagnosticsSnapshot = {
  generatedAt: string;
  overview: {
    overall: HealthState;
    livemopay: HealthState;
    livemopayReason: string;
    scheduler: HealthState;
    schedulerReason: string;
    schedulerLastInvocationAt: string | null;
    schedulerExpectedMinutes: number;
    connectionCount: number;
    healthyConnections: number;
    needsAttentionConnections: number;
    unresolvedCriticalEvents: number;
    lastApiContractCheckAt: string | null;
    lastApiContractSuccessAt: string | null;
    activePushSubscriptions: number;
    pushStatus: HealthState | null;
  };
  connections: DiagnosticConnection[];
  events: Array<{
    id: string;
    createdAt: string;
    severity: "info" | "warning" | "critical";
    category: string;
    eventType: string;
    connectionId: string | null;
    message: string;
    resolvedAt: string | null;
  }>;
};

function consecutiveFailures(rows: CaptureRunRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (row.status === "running") continue;
    if (row.status !== "failed") break;
    count += 1;
  }
  return count;
}

function toRun(row: CaptureRunRow): DiagnosticSyncRun {
  const durationMs = row.finished_at
    ? Math.max(0, new Date(row.finished_at).getTime() - new Date(row.started_at).getTime())
    : null;
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs,
    status: row.status,
    mode: row.mode,
    trigger: row.trigger,
    rowsSynced: row.rows_synced,
    error: row.error ? sanitizeDiagnosticMessage(row.error) : null
  };
}

export function diagnosticsSnapshotToJson(snapshot: DiagnosticsSnapshot): string {
  return JSON.stringify(snapshot);
}

export async function getDiagnosticsSnapshot(now: Date = new Date()): Promise<DiagnosticsSnapshot> {
  const [connectionRows, captureRows, authUsers, states, events, unresolvedEvents, activePushSubscriptions] =
    await Promise.all([
      adminSupabaseFetch<DiagnosticConnectionRow[]>(
        `/livemopay_connections?select=${DIAGNOSTIC_CONNECTION_SELECT}` +
          "&is_demo=eq.false&status=in.(connected,error,pending_selection)&order=updated_at.desc"
      ),
      adminSupabaseFetch<CaptureRunRow[]>(
        "/capture_runs?select=id,connection_id,started_at,finished_at,status,mode,trigger,rows_synced,error" +
          "&order=started_at.desc&limit=500"
      ),
      listAllAuthUsers(),
      getSystemHealthStates(),
      listRecentSystemEvents(40),
      listUnresolvedSystemEvents(),
      countPushSubscriptions()
    ]);

  // Only the newest current/non-disconnected row per user. This avoids an
  // old historical error row appearing beside a later active reconnect.
  const latestConnectionByUser = new Map<string, DiagnosticConnectionRow>();
  for (const row of connectionRows) {
    if (!latestConnectionByUser.has(row.user_id)) latestConnectionByUser.set(row.user_id, row);
  }

  const emailByUserId = new Map(authUsers.map((user) => [user.userId, user.email]));
  const runsByConnection = new Map<string, CaptureRunRow[]>();
  for (const run of captureRows) {
    const rows = runsByConnection.get(run.connection_id) ?? [];
    rows.push(run);
    runsByConnection.set(run.connection_id, rows);
  }

  const connections = Array.from(latestConnectionByUser.values()).map((row): DiagnosticConnection => {
    const runs = runsByConnection.get(row.id) ?? [];
    const recentRuns = runs.slice(0, 8).map(toRun);
    const lastAttempt = runs[0] ?? null;
    const lastSuccess = runs.find((run) => run.status === "success") ?? null;
    const lastSuccessfulSyncAt = lastSuccess?.finished_at ?? row.last_synced_at;
    const failureCount = consecutiveFailures(runs);
    const assessment = classifyConnectionHealth(
      {
        status: row.status,
        connectedAt: row.connected_at,
        autoSyncEnabled: row.auto_sync_enabled,
        nextSyncAt: row.next_sync_at,
        lastSuccessfulSyncAt,
        lastAttemptStatus: lastAttempt?.status ?? null,
        lastAutoSyncStatus: row.last_auto_sync_status,
        syncClaimedAt: row.sync_claimed_at,
        consecutiveFailures: failureCount
      },
      now
    );

    return {
      id: row.id,
      userEmail: emailByUserId.get(row.user_id) ?? null,
      accountLabel: row.account_label,
      status: row.status,
      health: assessment.state,
      healthReason: assessment.reason,
      lastSuccessfulSyncAt,
      lastAttemptAt: lastAttempt?.finished_at ?? lastAttempt?.started_at ?? null,
      lastAttemptStatus: lastAttempt?.status ?? null,
      lastError: row.last_error ? sanitizeDiagnosticMessage(row.last_error) : null,
      lastAutoSyncAt: row.last_auto_sync_at,
      lastAutoSyncStatus: row.last_auto_sync_status,
      lastAutoSyncError: row.last_auto_sync_error ? sanitizeDiagnosticMessage(row.last_auto_sync_error) : null,
      nextSyncAt: row.next_sync_at,
      syncClaimedAt: row.sync_claimed_at,
      claimStuck: Boolean(row.sync_claimed_at && now.getTime() - Date.parse(row.sync_claimed_at) > 15 * 60_000),
      stale: Boolean(lastSuccessfulSyncAt && now.getTime() - Date.parse(lastSuccessfulSyncAt) > 8 * 3_600_000),
      consecutiveFailures: failureCount,
      recentRuns
    };
  });
  connections.sort((a, b) => {
    const rank = { critical: 0, warning: 1, healthy: 2 } as const;
    return rank[a.health] - rank[b.health] || (a.userEmail ?? "").localeCompare(b.userEmail ?? "");
  });

  const stateByComponent = new Map(states.map((state) => [state.component, state]));
  const schedulerState = stateByComponent.get("scheduler:auto-sync") ?? null;
  const canaryState = stateByComponent.get("livemopay:canary") ?? null;
  const pushState = stateByComponent.get("push:delivery") ?? null;
  const scheduler = classifySchedulerHealth(schedulerState?.lastCheckedAt ?? null, now);
  const livemopay = classifyCanaryHealth(
    canaryState?.status ?? null,
    canaryState?.lastCheckedAt ?? null,
    canaryState?.lastSuccessAt ?? null,
    now
  );
  const connectionState = worstHealthState(connections.map((connection) => connection.health));
  const unresolvedCriticalEvents = unresolvedEvents.filter((event) => event.severity === "critical").length;
  const overall = worstHealthState([
    scheduler.state,
    livemopay.state,
    connectionState,
    unresolvedCriticalEvents > 0 ? "critical" : "healthy",
    pushState?.status ?? "healthy"
  ]);

  return {
    generatedAt: now.toISOString(),
    overview: {
      overall,
      livemopay: livemopay.state,
      livemopayReason: livemopay.reason,
      scheduler: scheduler.state,
      schedulerReason: scheduler.reason,
      schedulerLastInvocationAt: schedulerState?.lastCheckedAt ?? null,
      schedulerExpectedMinutes: 5,
      connectionCount: connections.length,
      healthyConnections: connections.filter((connection) => connection.health === "healthy").length,
      needsAttentionConnections: connections.filter((connection) => connection.health !== "healthy").length,
      unresolvedCriticalEvents,
      lastApiContractCheckAt: canaryState?.lastCheckedAt ?? null,
      lastApiContractSuccessAt: canaryState?.lastSuccessAt ?? null,
      activePushSubscriptions,
      pushStatus: pushState?.status ?? null
    },
    connections,
    events: events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      severity: event.severity,
      category: event.category,
      eventType: event.eventType,
      connectionId: event.connectionId,
      message: event.message,
      resolvedAt: event.resolvedAt
    }))
  };
}
