import "server-only";

import { adminSupabaseFetch } from "../supabase-rest";
import { classifySchedulerHealth, REPEATED_FAILURE_THRESHOLD } from "./health";
import { sendOperationalPushToAdmins } from "./notifications";
import {
  getSystemHealthState,
  openSystemIncident,
  recordSystemEvent,
  recordSystemHealthCheck,
  resolveSystemIncident,
  sanitizeDiagnosticMessage
} from "./store";

type CaptureStatusRow = { status: "running" | "success" | "failed" };

export async function countConsecutiveSyncFailures(connectionId: string): Promise<number> {
  const rows = await adminSupabaseFetch<CaptureStatusRow[]>(
    `/capture_runs?select=status&connection_id=eq.${encodeURIComponent(connectionId)}&order=started_at.desc&limit=10`
  );

  let failures = 0;
  for (const row of rows) {
    if (row.status === "running") continue;
    if (row.status !== "failed") break;
    failures += 1;
  }
  return failures;
}

export async function reportConnectionSyncSuccess(connectionId: string): Promise<void> {
  await Promise.all([
    resolveSystemIncident(`sync:repeated:${connectionId}`, {
      category: "sync",
      eventType: "connection_sync_recovered",
      connectionId,
      message: "A repeatedly failing connection recovered."
    }),
    resolveSystemIncident(`sync:reauth:${connectionId}`, {
      category: "sync",
      eventType: "connection_reauthenticated",
      connectionId,
      message: "A connection requiring reauthentication recovered."
    })
  ]);
}

export async function reportConnectionSyncFailure(connectionId: string, error: unknown): Promise<void> {
  const consecutiveFailures = await countConsecutiveSyncFailures(connectionId);
  if (consecutiveFailures < REPEATED_FAILURE_THRESHOLD) return;

  const incident = await openSystemIncident({
    severity: "critical",
    category: "sync",
    eventType: "connection_repeated_failures",
    connectionId,
    message: `A LiveMopay connection has failed ${consecutiveFailures} consecutive sync attempts.`,
    metadata: { consecutiveFailures, error: sanitizeDiagnosticMessage(error) },
    incidentKey: `sync:repeated:${connectionId}`
  });

  if (incident.created || incident.escalated) {
    await sendOperationalPushToAdmins({
      title: "NewinMeter sync needs attention",
      body: "A LiveMopay connection is repeatedly failing.",
      connectionId,
      eventId: incident.event.id,
      tag: `newinmeter-system-sync-${connectionId}`
    });
  }
}

export async function reportConnectionReauthenticationRequired(connectionId: string): Promise<void> {
  const incident = await openSystemIncident({
    severity: "critical",
    category: "sync",
    eventType: "connection_reauthentication_required",
    connectionId,
    message: "A LiveMopay connection requires reauthentication.",
    incidentKey: `sync:reauth:${connectionId}`
  });

  if (incident.created || incident.escalated) {
    await sendOperationalPushToAdmins({
      title: "LiveMopay reconnection required",
      body: "A NewinMeter connection requires administrator attention.",
      connectionId,
      eventId: incident.event.id,
      tag: `newinmeter-system-reauth-${connectionId}`
    });
  }
}

export async function reportBroadSyncOutcome(counts: {
  success: number;
  retryable: number;
  authError: number;
  unexpected: number;
}): Promise<void> {
  const attempted = counts.success + counts.retryable + counts.authError + counts.unexpected;
  const failed = counts.retryable + counts.authError + counts.unexpected;
  const broadFailure = attempted >= 3 && failed >= 3 && failed / attempted >= 0.5;

  if (!broadFailure) {
    if (counts.success > 0) {
      await resolveSystemIncident("sync:broad_failure", {
        category: "sync",
        eventType: "broad_sync_failure_recovered",
        message: "Broad automatic-sync failures recovered."
      });
    }
    return;
  }

  const incident = await openSystemIncident({
    severity: "critical",
    category: "sync",
    eventType: "broad_sync_failure",
    message: "Multiple LiveMopay connections failed in the same scheduler batch.",
    metadata: { attempted, failed },
    incidentKey: "sync:broad_failure"
  });
  if (incident.created || incident.escalated) {
    await sendOperationalPushToAdmins({
      title: "Widespread NewinMeter sync failures",
      body: "Multiple LiveMopay connections failed in one automatic-sync batch.",
      eventId: incident.event.id,
      tag: "newinmeter-system-broad-sync"
    });
  }
}

export async function reportAlertEvaluationOutcome(
  connectionId: string,
  family: string,
  error?: unknown
): Promise<void> {
  const incidentKey = `alerts:evaluation:${connectionId}:${family}`;
  if (!error) {
    await resolveSystemIncident(incidentKey, {
      category: "alerts",
      eventType: "alert_evaluation_recovered",
      connectionId,
      message: `Alert evaluation recovered for the ${family} family.`
    });
    return;
  }

  await openSystemIncident({
    severity: "warning",
    category: "alerts",
    eventType: "alert_evaluation_failed",
    connectionId,
    message: `Alert evaluation failed for the ${family} family.`,
    metadata: { family, error: sanitizeDiagnosticMessage(error) },
    incidentKey
  });
}

export async function recordSchedulerInvocation(details: Record<string, number>): Promise<void> {
  const previous = await getSystemHealthState("scheduler:auto-sync");
  const previousAssessment = classifySchedulerHealth(previous?.lastCheckedAt ?? null);

  await recordSystemHealthCheck({
    component: "scheduler:auto-sync",
    status: "healthy",
    succeeded: true,
    details
  });

  if (previous && previousAssessment.state === "critical") {
    await recordSystemEvent({
      severity: "info",
      category: "scheduler",
      eventType: "scheduler_activity_recovered",
      message: "The automatic-sync scheduler resumed after a delayed heartbeat.",
      resolvedAt: new Date().toISOString()
    });
  }
  await resolveSystemIncident("scheduler:auto-sync:stopped", {
    category: "scheduler",
    eventType: "scheduler_recovered",
    message: "The automatic-sync scheduler recovered."
  });
}

export async function evaluateSchedulerWatchdog(
  now: Date = new Date()
): Promise<ReturnType<typeof classifySchedulerHealth>> {
  const scheduler = await getSystemHealthState("scheduler:auto-sync");
  const assessment = classifySchedulerHealth(scheduler?.lastCheckedAt ?? null, now);

  if (assessment.state === "healthy") {
    await resolveSystemIncident("scheduler:auto-sync:stopped", {
      category: "scheduler",
      eventType: "scheduler_recovered",
      message: "The automatic-sync scheduler recovered."
    });
    return assessment;
  }

  const incident = await openSystemIncident({
    severity: assessment.state,
    category: "scheduler",
    eventType: assessment.state === "critical" ? "scheduler_stopped" : "scheduler_delayed",
    message: assessment.reason,
    metadata: { expectedIntervalMinutes: 5 },
    incidentKey: "scheduler:auto-sync:stopped"
  });

  if (assessment.state === "critical" && (incident.created || incident.escalated)) {
    await sendOperationalPushToAdmins({
      title: "NewinMeter scheduler is delayed",
      body: "The automatic-sync worker has stopped checking in.",
      eventId: incident.event.id,
      tag: "newinmeter-system-scheduler"
    });
  }
  return assessment;
}
