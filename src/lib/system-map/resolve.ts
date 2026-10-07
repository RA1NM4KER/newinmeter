import { MAINTENANCE_JOBS, passiveObservation } from "./passive";
import type { DiagnosticsSnapshot } from "../diagnostics/data";
import type { SystemHealthState } from "../diagnostics/store";
import type { HealthState } from "../diagnostics/health";
import { SYSTEM_EDGES, SYSTEM_NODES, type TelemetrySource } from "./topology";
import type { MapHealth, Observation, SystemMapSnapshot } from "./model";

type Event = DiagnosticsSnapshot["events"][number];
export type MapEvidence = {
  diagnostics: DiagnosticsSnapshot;
  states: (Pick<SystemHealthState, "component" | "status" | "lastCheckedAt" | "lastSuccessAt"> & {
    details?: Record<string, unknown>;
  })[];
  // Includes unresolved incidents outside the recent-event window.
  events: Event[];
};

const HOUR = 3_600_000;
const translated: Record<HealthState, MapHealth> = { healthy: "healthy", warning: "degraded", critical: "failed" };
function newest(values: (string | null)[]) {
  return (
    values
      .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
  );
}
function recent(value: string | null, now: number, window: number) {
  if (!value) return false;
  const age = now - Date.parse(value);
  return Number.isFinite(age) && age >= -30_000 && age <= window;
}
function unknown(reason: string): Observation {
  return {
    status: "unknown",
    reason,
    observedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    affectedBy: [],
    metrics: [],
    events: []
  };
}
function eventDetails(events: Event[]) {
  // An old unresolved incident can still explain today's health. Do not hide
  // it behind six newer recoveries just because the inspector is bounded.
  return [...events]
    .sort((a, b) => {
      const priority = (event: Event) =>
        !event.resolvedAt && event.severity !== "info" ? (event.severity === "critical" ? 2 : 1) : 0;
      return priority(b) - priority(a) || Date.parse(b.createdAt) - Date.parse(a.createdAt);
    })
    .slice(0, 6)
    .map(({ id, createdAt, message, severity, resolvedAt }) => ({ id, createdAt, message, severity, resolvedAt }));
}

export function buildSystemMap(evidence: MapEvidence, now = new Date()): SystemMapSnapshot {
  const { diagnostics, states, events } = evidence;
  const time = now.getTime();
  const overview = diagnostics.overview;
  const state = (component: string) => states.find((entry) => entry.component === component);
  const byCategory = (category: string) =>
    events
      .filter((event) => event.category === category)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  function withEvents(observation: Observation, category: string): Observation {
    const matching = byCategory(category);
    return {
      ...observation,
      events: eventDetails(matching),
      lastFailureAt: newest([
        observation.lastFailureAt,
        ...matching.filter((event) => event.severity !== "info").map((event) => event.createdAt)
      ])
    };
  }
  const runs = diagnostics.connections.flatMap((connection) => connection.recentRuns);
  const successfulRuns = runs.filter((run) => run.status === "success");
  const latestRun = [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
  const lastSyncSuccess = newest(diagnostics.connections.map((connection) => connection.lastSuccessfulSyncAt));
  const lastSyncFailure = newest(
    runs.filter((run) => run.status === "failed").map((run) => run.finishedAt ?? run.startedAt)
  );
  const syncObserved = newest(diagnostics.connections.map((connection) => connection.lastAttemptAt));
  const syncMetrics = [
    { label: "Current connections", value: String(overview.connectionCount) },
    { label: "Connections needing attention", value: String(overview.needsAttentionConnections) },
    { label: "Runs in bounded sample", value: String(runs.length) },
    {
      label: "Rows in successful sampled runs",
      value: successfulRuns.reduce((total, run) => total + (run.rowsSynced ?? 0), 0).toLocaleString("en-ZA")
    },
    {
      label: "Latest run duration (whole pipeline)",
      value: latestRun?.durationMs != null ? `${(latestRun.durationMs / 1000).toFixed(1)} s` : "Not recorded"
    },
    { label: "Latest run rows", value: latestRun?.rowsSynced != null ? String(latestRun.rowsSynced) : "Not recorded" }
  ];
  const resolvers: Record<TelemetrySource, () => Observation> = {
    unknown: () => unknown("No independent health telemetry is recorded for this component or connection."),
    database: () => ({
      ...unknown("The diagnostics database read succeeded. Other reads and writes are not independently checked."),
      status: "healthy",
      observedAt: diagnostics.generatedAt,
      lastSuccessAt: diagnostics.generatedAt
    }),
    scheduler: () => {
      const heartbeat = overview.schedulerLastInvocationAt;
      return withEvents(
        {
          ...unknown(overview.schedulerReason),
          status:
            heartbeat && Number.isFinite(Date.parse(heartbeat)) && Date.parse(heartbeat) <= time + 30_000
              ? translated[overview.scheduler]
              : "unknown",
          observedAt: heartbeat,
          lastSuccessAt: heartbeat,
          metrics: [{ label: "Expected worker interval", value: `${overview.schedulerExpectedMinutes} minutes` }]
        },
        "scheduler"
      );
    },
    canary: () => {
      const canary = state("livemopay:canary");
      const checked = overview.lastApiContractCheckAt;
      const fresh = recent(checked, time, 48 * HOUR);
      return withEvents(
        {
          ...unknown(
            fresh
              ? overview.livemopayReason
              : "The daily contract check is missing or over 48 hours old. Current provider health is unknown."
          ),
          status: fresh ? translated[overview.livemopay] : "unknown",
          observedAt: checked,
          lastSuccessAt: overview.lastApiContractSuccessAt,
          lastFailureAt: canary?.status === "critical" ? canary.lastCheckedAt : null,
          metrics: [
            { label: "Probe scope", value: "Login, refresh, discovery, ledger & parser" },
            { label: "Expected check interval", value: "Daily" }
          ]
        },
        "livemopay"
      );
    },
    sync: () =>
      withEvents(
        {
          ...unknown(
            overview.needsAttentionConnections > 0
              ? `${overview.needsAttentionConnections} of ${overview.connectionCount} connections need attention. Inspect Diagnostics for individual causes.`
              : recent(lastSyncSuccess, time, 8 * HOUR)
                ? "Connections are healthy and a successful sync was recorded within eight hours."
                : "No recent successful sync is available. Connections may be idle, paused or archived; this does not prove a worker failure."
          ),
          status:
            overview.needsAttentionConnections > 0
              ? "degraded"
              : recent(lastSyncSuccess, time, 8 * HOUR)
                ? "healthy"
                : "unknown",
          observedAt: syncObserved,
          lastSuccessAt: lastSyncSuccess,
          lastFailureAt: lastSyncFailure,
          metrics: syncMetrics
        },
        "sync"
      ),
    rollups: () => ({
      ...unknown(
        recent(lastSyncSuccess, time, 8 * HOUR)
          ? "A recent successful capture completed the synchronous rollup trigger. This is indirect evidence, not a data-quality check."
          : "No recent successful capture confirms rollup completion. There is no independent rollup probe."
      ),
      status: recent(lastSyncSuccess, time, 8 * HOUR) ? "healthy" : "unknown",
      observedAt: lastSyncSuccess,
      lastSuccessAt: lastSyncSuccess,
      metrics: [{ label: "Evidence", value: "Successful capture finalization" }]
    }),
    ai: () => {
      const observation = passiveObservation(states, "ai:requests", time);
      observation.metrics.push({ label: "Scope", value: "Accepted assistant requests, including model and tool work" });
      return observation;
    },
    maintenance: () => {
      const jobs = MAINTENANCE_JOBS.map(([id, label]) => ({
        label,
        observation: passiveObservation(states, `cron:${id}`, time, true)
      }));
      const statuses = jobs.map(({ observation }) => observation.status);
      return {
        ...unknown(
          statuses.includes("unknown") && !statuses.includes("failed") && !statuses.includes("degraded")
            ? `Unknown, not failed: ${jobs
                .filter(({ observation }) => observation.status === "unknown")
                .map(({ label }) => label)
                .join(", ")} ha${jobs.filter(({ observation }) => observation.status === "unknown").length === 1 ? "s" : "ve"} not recorded a completion heartbeat yet. A job that has never reported cannot be told apart from one that never ran, so it is not marked healthy or failed until its first heartbeat arrives (next scheduled run). Inspect each job below.`
            : "Daily maintenance outcomes. Inspect each job below; missing heartbeats do not identify the underlying cause."
        ),
        status: statuses.includes("failed")
          ? "failed"
          : statuses.includes("degraded")
            ? "degraded"
            : statuses.includes("unknown")
              ? "unknown"
              : "healthy",
        observedAt: newest(jobs.map(({ observation }) => observation.observedAt)),
        lastSuccessAt: newest(jobs.map(({ observation }) => observation.lastSuccessAt)),
        lastFailureAt: newest(jobs.map(({ observation }) => observation.lastFailureAt)),
        metrics: jobs.flatMap(({ label, observation }) => [
          { label, value: `${observation.status}: ${observation.reason}` },
          { label: `${label}: last completion`, value: observation.observedAt ?? "Not recorded" },
          ...observation.metrics.map((metric) => ({ label: `${label}: ${metric.label}`, value: metric.value }))
        ])
      };
    },
    staleCheck: () => passiveObservation(states, "cron:stale-check", time, true),
    alerts: () => {
      const matching = byCategory("alerts");
      const unresolved = matching.filter((event) => !event.resolvedAt && event.severity !== "info");
      const fresh = passiveObservation(states, "alerts:fresh", time);
      const delayed = passiveObservation(states, "alerts:delayed", time);
      const sampled = [fresh, delayed];
      const hasFailure = sampled.some((entry) => entry.status === "degraded");
      const hasSuccess = sampled.some((entry) => entry.status === "healthy");
      return withEvents(
        {
          ...unknown(
            unresolved.length
              ? `${unresolved.length} unresolved alert evaluation incident(s). Other alert families may still work.`
              : hasFailure
                ? "A sampled alert evaluation failed. Inspect the family outcomes below."
                : hasSuccess
                  ? "An enabled-rule evaluation completed successfully. No notification needs to fire for this check to pass."
                  : "No recent enabled-rule evaluation has been observed. Disabled rules and empty rule sets are not successful evaluations."
          ),
          status: unresolved.some((event) => event.severity === "critical")
            ? "failed"
            : unresolved.length || hasFailure
              ? "degraded"
              : hasSuccess
                ? "healthy"
                : "unknown",
          observedAt: newest([matching[0]?.createdAt ?? null, ...sampled.map((entry) => entry.observedAt)]),
          lastSuccessAt: newest(sampled.map((entry) => entry.lastSuccessAt)),
          lastFailureAt: newest(sampled.map((entry) => entry.lastFailureAt)),
          metrics: [
            { label: "Unresolved evaluation incidents", value: String(unresolved.length) },
            ...sampled.flatMap((entry, index) => [
              { label: index === 0 ? "Post-sync evaluation" : "Delayed-data evaluation", value: entry.status },
              ...entry.metrics.map((metric) => ({
                label: `${index === 0 ? "Post-sync" : "Delayed-data"}: ${metric.label}`,
                value: metric.value
              }))
            ])
          ]
        },
        "alerts"
      );
    },
    push: () => {
      const push = state("push:delivery");
      const unresolved = byCategory("push").filter((event) => !event.resolvedAt && event.severity !== "info");
      const fresh = recent(push?.lastCheckedAt ?? null, time, 24 * HOUR);
      return withEvents(
        {
          ...unknown(
            unresolved.length
              ? "Unresolved push delivery failures need attention. Device receipt is not measured."
              : fresh
                ? "Latest recorded delivery outcome, scoped to push-service acceptance. Device receipt is not measured."
                : "No delivery outcome in the last 24 hours. Push is event-driven, so silence is not a failure."
          ),
          status: unresolved.length ? "degraded" : fresh && push ? translated[push.status] : "unknown",
          observedAt: push?.lastCheckedAt ?? null,
          lastSuccessAt: push?.lastSuccessAt ?? null,
          lastFailureAt: push && push.status !== "healthy" ? push.lastCheckedAt : null,
          metrics: [{ label: "Active subscriptions", value: String(overview.activePushSubscriptions) }]
        },
        "push"
      );
    }
  };
  const nodes: SystemMapSnapshot["nodes"] = Object.fromEntries(
    SYSTEM_NODES.map((node) => [node.id, resolvers[node.source]()])
  );
  // Only explicit dependency paths carry possible impact. Keep independent
  // measured failures intact; dependency topology alone cannot prove causation.
  for (let pass = 0; pass < SYSTEM_NODES.length; pass++) {
    let changed = false;
    for (const edge of SYSTEM_EDGES) {
      if (!edge.propagatesImpact) continue;
      const from = edge.source === "staleCheck" ? resolvers.staleCheck() : nodes[edge.from];
      const to = nodes[edge.to];
      const roots = from.status === "failed" ? [edge.from] : from.affectedBy;
      for (const root of roots) {
        if (root !== edge.to && !to.affectedBy.includes(root)) {
          to.affectedBy.push(root);
          changed = true;
        }
      }
      if (to.affectedBy.length && (to.status === "unknown" || (edge.to === "sync" && to.status !== "failed"))) {
        to.status = "affected";
      }
    }
    if (!changed) break;
  }
  const edges: SystemMapSnapshot["edges"] = Object.fromEntries(
    SYSTEM_EDGES.map((edge) => {
      const observation = resolvers[edge.source]();
      const from = edge.source === "staleCheck" ? resolvers.staleCheck() : nodes[edge.from];
      const affectedBy = from.status === "failed" ? [edge.from] : [...from.affectedBy];
      if (affectedBy.length) {
        observation.affectedBy = affectedBy;
        if (observation.status !== "failed") observation.status = "affected";
      }
      return [edge.id, observation];
    })
  );
  return { generatedAt: now.toISOString(), nodes, edges };
}
