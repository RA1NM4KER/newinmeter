export const HEALTH_STATES = ["healthy", "warning", "critical"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const SCHEDULER_EXPECTED_INTERVAL_MINUTES = 5;
export const SCHEDULER_WARNING_AFTER_MINUTES = 15;
export const SCHEDULER_CRITICAL_AFTER_MINUTES = 30;
export const SYNC_CLAIM_STUCK_AFTER_MINUTES = 15;
export const CONNECTION_WARNING_AFTER_HOURS = 8;
export const CONNECTION_CRITICAL_AFTER_HOURS = 24;
export const CANARY_WARNING_AFTER_HOURS = 36;
export const CANARY_CRITICAL_AFTER_HOURS = 48;
export const REPEATED_FAILURE_THRESHOLD = 3;

export type HealthAssessment = {
  state: HealthState;
  reason: string;
};

export type ConnectionHealthInput = {
  status: "connected" | "pending_selection" | "disconnected" | "error";
  connectedAt: string;
  autoSyncEnabled: boolean;
  nextSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastAttemptStatus: "running" | "success" | "failed" | null;
  lastAutoSyncStatus: "success" | "failed" | null;
  syncClaimedAt: string | null;
  consecutiveFailures: number;
};

function ageMs(iso: string, now: Date) {
  return Math.max(0, now.getTime() - new Date(iso).getTime());
}

export function worstHealthState(states: HealthState[]): HealthState {
  if (states.includes("critical")) return "critical";
  if (states.includes("warning")) return "warning";
  return "healthy";
}

export function classifySchedulerHealth(lastInvocationAt: string | null, now: Date = new Date()): HealthAssessment {
  if (!lastInvocationAt) {
    return { state: "critical", reason: "No scheduler worker invocation has been recorded." };
  }

  const minutes = ageMs(lastInvocationAt, now) / MINUTE_MS;
  if (minutes > SCHEDULER_CRITICAL_AFTER_MINUTES) {
    return { state: "critical", reason: `Scheduler worker has not checked in for ${Math.floor(minutes)} minutes.` };
  }
  if (minutes > SCHEDULER_WARNING_AFTER_MINUTES) {
    return { state: "warning", reason: `Scheduler worker is ${Math.floor(minutes)} minutes behind.` };
  }
  return { state: "healthy", reason: "Scheduler worker activity is on time." };
}

export function classifyCanaryHealth(
  state: HealthState | null,
  lastCheckedAt: string | null,
  lastSuccessAt: string | null,
  now: Date = new Date()
): HealthAssessment {
  if (!lastCheckedAt) {
    return { state: "critical", reason: "The LiveMopay contract canary has not run yet." };
  }
  if (state === "critical") {
    return { state: "critical", reason: "The latest LiveMopay contract canary failed after retry." };
  }
  if (!lastSuccessAt) {
    return { state: "critical", reason: "No successful LiveMopay contract check has been recorded." };
  }

  const hours = ageMs(lastSuccessAt, now) / HOUR_MS;
  if (hours > CANARY_CRITICAL_AFTER_HOURS) {
    return { state: "critical", reason: "The last successful LiveMopay contract check is over 48 hours old." };
  }
  if (state === "warning" || hours > CANARY_WARNING_AFTER_HOURS) {
    return { state: "warning", reason: "The LiveMopay contract check is delayed or recovered only after retry." };
  }
  return { state: "healthy", reason: "The latest LiveMopay contract check passed." };
}

export function classifyConnectionHealth(connection: ConnectionHealthInput, now: Date = new Date()): HealthAssessment {
  if (connection.status === "error") {
    return { state: "critical", reason: "Connection requires reauthentication." };
  }
  if (connection.status !== "connected") {
    return { state: "warning", reason: "Connection setup is incomplete." };
  }

  if (connection.syncClaimedAt && ageMs(connection.syncClaimedAt, now) > SYNC_CLAIM_STUCK_AFTER_MINUTES * MINUTE_MS) {
    return { state: "critical", reason: "Automatic sync claim appears stuck." };
  }

  if (connection.consecutiveFailures >= REPEATED_FAILURE_THRESHOLD) {
    return {
      state: "critical",
      reason: `${connection.consecutiveFailures} consecutive sync failures require attention.`
    };
  }

  if (connection.autoSyncEnabled && connection.nextSyncAt) {
    const overdueMs = now.getTime() - new Date(connection.nextSyncAt).getTime();
    if (overdueMs > 2 * HOUR_MS) {
      return { state: "critical", reason: "This connection is more than two hours overdue for automatic sync." };
    }
    if (overdueMs > 30 * MINUTE_MS) {
      return { state: "warning", reason: "This connection is overdue for automatic sync." };
    }
  }

  if (!connection.lastSuccessfulSyncAt) {
    const connectedHours = ageMs(connection.connectedAt, now) / HOUR_MS;
    return connectedHours > CONNECTION_CRITICAL_AFTER_HOURS
      ? { state: "critical", reason: "No successful sync has completed for this connection." }
      : { state: "warning", reason: "Waiting for the first successful sync." };
  }

  const hoursSinceSuccess = ageMs(connection.lastSuccessfulSyncAt, now) / HOUR_MS;
  if (hoursSinceSuccess > CONNECTION_CRITICAL_AFTER_HOURS) {
    return { state: "critical", reason: "Last successful sync is over 24 hours old." };
  }
  if (
    hoursSinceSuccess > CONNECTION_WARNING_AFTER_HOURS ||
    connection.lastAttemptStatus === "failed" ||
    connection.lastAutoSyncStatus === "failed"
  ) {
    return { state: "warning", reason: "Recent sync health needs watching." };
  }

  return { state: "healthy", reason: "Sync activity is normal." };
}
