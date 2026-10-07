import type { MapEvidence } from "./resolve";
import type { Observation } from "./model";

const HOUR = 3_600_000;
const names = { "stale-check": "Stale-data check", "reset-demo": "Demo reset", "cold-storage": "Cold storage" };
export const MAINTENANCE_JOBS = Object.entries(names);

export function passiveObservation(
  states: MapEvidence["states"],
  component: string,
  now: number,
  scheduled = false
): Observation {
  const find = (outcome: string) =>
    states.find(
      (entry) =>
        entry.component === `passive:${component}:${outcome}` &&
        Number.isFinite(Date.parse(entry.lastCheckedAt)) &&
        Date.parse(entry.lastCheckedAt) <= now + 30_000
    );
  const success = find("success");
  const failure = find("failure");
  const candidates = [success, failure, find("skipped")].filter(
    (entry): entry is MapEvidence["states"][number] => !!entry
  );
  const latest = candidates.sort((a, b) => Date.parse(b.lastCheckedAt) - Date.parse(a.lastCheckedAt))[0];
  const observation: Observation = {
    status: "unknown",
    reason: "No completed work has been observed yet.",
    observedAt: latest?.lastCheckedAt ?? null,
    lastSuccessAt: success?.lastCheckedAt ?? null,
    lastFailureAt: failure?.lastCheckedAt ?? null,
    affectedBy: [],
    metrics: [],
    events: []
  };
  if (!latest) {
    if (scheduled) {
      observation.reason =
        "No completion heartbeat has been recorded yet. Heartbeats only exist from when this telemetry was deployed, so a job that has not run since then looks the same as a job that never runs. It turns healthy after the next scheduled run and degrades if no heartbeat arrives within 26 hours of the last one. If it is still unknown after a full day, check that the Vercel cron is scheduled and running.";
    }
    return observation;
  }
  const duration = latest.details?.durationMs;
  const evaluated = latest.details?.evaluatedCount;
  if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) {
    observation.metrics.push({ label: "Latest sampled duration", value: `${(duration / 1000).toFixed(1)} s` });
  }
  if (typeof evaluated === "number" && Number.isFinite(evaluated) && evaluated >= 0) {
    observation.metrics.push({ label: "Rules checked in sampled evaluation", value: String(evaluated) });
  }
  const age = now - Date.parse(latest.lastCheckedAt);
  if (scheduled && age > 26 * HOUR) {
    observation.status = age > 48 * HOUR ? "failed" : "degraded";
    observation.reason =
      "The daily job has no recent completion heartbeat. It may have been missed, stopped or timed out.";
  } else if (latest.component.endsWith(":skipped")) {
    observation.reason =
      "The latest invocation was skipped because the demo account is not configured. No reset was performed.";
  } else if (scheduled) {
    observation.status = latest === failure ? "failed" : "healthy";
    observation.reason =
      latest === failure
        ? "The latest invocation failed or reported a partial failure."
        : "The latest daily invocation completed successfully, including a valid no-work run.";
  } else {
    const recentFailure = failure && now - Date.parse(failure.lastCheckedAt) <= HOUR / 2;
    observation.status = age > 24 * HOUR ? "unknown" : latest === failure || recentFailure ? "degraded" : "healthy";
    observation.reason =
      age > 24 * HOUR
        ? "No real work has been observed in the last 24 hours. Inactivity is not a failure."
        : observation.status === "degraded"
          ? "A sampled operation failed recently. A later success does not prove every request or rule recovered."
          : "A sampled operation completed successfully. This observes real work only, not a synthetic availability probe.";
  }
  return observation;
}
