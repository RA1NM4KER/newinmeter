import type { DiagnosticsSnapshot, DiagnosticConnection } from "../src/lib/diagnostics/data";
import type { MapEvidence } from "../src/lib/system-map/resolve";

export const MAP_TEST_TIME = "2026-10-07T12:00:00.000Z";
export function mapConnection(overrides: Partial<DiagnosticConnection> = {}): DiagnosticConnection {
  return {
    id: "connection-1",
    userEmail: "private@example.com",
    accountLabel: "Private household",
    status: "connected",
    health: "healthy",
    healthReason: "Recent sync",
    lastSuccessfulSyncAt: MAP_TEST_TIME,
    lastAttemptAt: MAP_TEST_TIME,
    lastAttemptStatus: "success",
    lastError: null,
    lastAutoSyncAt: MAP_TEST_TIME,
    lastAutoSyncStatus: "success",
    lastAutoSyncError: null,
    nextSyncAt: null,
    syncClaimedAt: null,
    claimStuck: false,
    stale: false,
    consecutiveFailures: 0,
    recentRuns: [
      {
        id: "run-1",
        startedAt: "2026-10-07T11:59:50.000Z",
        finishedAt: MAP_TEST_TIME,
        durationMs: 10000,
        status: "success",
        mode: "incremental",
        trigger: "auto",
        rowsSynced: 42,
        error: null
      }
    ],
    dataState: "warm",
    hibernationError: null,
    coldAt: null,
    restoreStartedAt: null,
    restoreError: null,
    ...overrides
  };
}
export function mapEvidence(): MapEvidence {
  const diagnostics: DiagnosticsSnapshot = {
    generatedAt: MAP_TEST_TIME,
    overview: {
      overall: "healthy",
      livemopay: "healthy",
      livemopayReason: "Contract passed",
      scheduler: "healthy",
      schedulerReason: "Worker is on time",
      schedulerLastInvocationAt: MAP_TEST_TIME,
      schedulerExpectedMinutes: 5,
      connectionCount: 1,
      healthyConnections: 1,
      needsAttentionConnections: 0,
      unresolvedCriticalEvents: 0,
      lastApiContractCheckAt: MAP_TEST_TIME,
      lastApiContractSuccessAt: MAP_TEST_TIME,
      activePushSubscriptions: 3,
      pushStatus: "healthy",
      warmConnections: 1,
      hibernatingConnections: 0,
      coldConnections: 0,
      restoringConnections: 0,
      restoreFailedConnections: 0,
      tariffProfileMissingCount: 0
    },
    connections: [mapConnection()],
    events: []
  };
  return {
    diagnostics,
    states: [
      { component: "livemopay:canary", status: "healthy", lastCheckedAt: MAP_TEST_TIME, lastSuccessAt: MAP_TEST_TIME },
      { component: "push:delivery", status: "healthy", lastCheckedAt: MAP_TEST_TIME, lastSuccessAt: MAP_TEST_TIME }
    ],
    events: []
  };
}
