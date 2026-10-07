import { describe, expect, it } from "vitest";
import { buildSystemMap } from "./resolve";
import { passiveObservation } from "./passive";
import { mapEvidence, MAP_TEST_TIME } from "../../../test/system-map-fixture";
const now = new Date(MAP_TEST_TIME);
const state = (component: string, outcome = "success", time = MAP_TEST_TIME) => ({
  component: `passive:${component}:${outcome}`,
  status: "healthy" as const,
  lastCheckedAt: time,
  lastSuccessAt: outcome === "success" ? time : null,
  details: { durationMs: 1234, evaluatedCount: 2, secret: "never serialize" }
});

describe("passive map observations", () => {
  it("shows healthy only after real work, with duration and no raw metadata", () => {
    const evidence = mapEvidence();
    evidence.states.push(state("ai:requests"), state("alerts:fresh"));
    const snapshot = buildSystemMap(evidence, now);
    expect(snapshot.nodes.ai.status).toBe("healthy");
    expect(snapshot.nodes.alerts.status).toBe("healthy");
    expect(snapshot.nodes.ai.metrics).toContainEqual({ label: "Latest sampled duration", value: "1.2 s" });
    expect(JSON.stringify(snapshot)).not.toContain("never serialize");
  });

  it("does not interpret inactive AI as broken or clear a recent failure with one success", () => {
    const states = [state("ai:requests", "failure", "2026-10-07T11:50:00Z"), state("ai:requests")];
    expect(passiveObservation(states, "ai:requests", now.getTime()).status).toBe("degraded");
    expect(passiveObservation(states, "ai:requests", now.getTime() + 31 * 60_000).status).toBe("healthy");
    expect(passiveObservation(states, "ai:requests", now.getTime() + 25 * 3_600_000).status).toBe("unknown");
  });

  it("detects missed daily jobs, explicit failures and skipped configuration", () => {
    const states = [state("cron:stale-check")];
    expect(passiveObservation(states, "cron:stale-check", now.getTime() + 27 * 3_600_000, true).status).toBe(
      "degraded"
    );
    expect(passiveObservation(states, "cron:stale-check", now.getTime() + 49 * 3_600_000, true).status).toBe("failed");
    expect(
      passiveObservation([state("cron:reset-demo", "skipped")], "cron:reset-demo", now.getTime(), true).status
    ).toBe("unknown");
    expect(
      passiveObservation([state("cron:cold-storage", "failure")], "cron:cold-storage", now.getTime(), true).status
    ).toBe("failed");
  });

  it("does not attribute a cold-storage failure to the independent stale-check path", () => {
    const evidence = mapEvidence();
    evidence.states.push(state("cron:stale-check"), state("cron:reset-demo"), state("cron:cold-storage", "failure"));
    const snapshot = buildSystemMap(evidence, now);
    expect(snapshot.nodes.cron.status).toBe("failed");
    expect(snapshot.edges["cron-alerts"].status).toBe("healthy");
    expect(snapshot.nodes.alerts.affectedBy).toEqual([]);
    evidence.states.push(state("cron:stale-check", "failure", "2026-10-07T12:00:01Z"));
    const failing = buildSystemMap(evidence, now);
    expect(failing.nodes.alerts.affectedBy).toEqual(["cron"]);
  });

  it("keeps unresolved alert incidents authoritative despite a successful sample", () => {
    const evidence = mapEvidence();
    evidence.states.push(state("alerts:fresh"));
    evidence.events.push({
      id: "event",
      createdAt: MAP_TEST_TIME,
      severity: "warning",
      category: "alerts",
      eventType: "failed",
      message: "Another connection is failing",
      connectionId: null,
      resolvedAt: null
    });
    expect(buildSystemMap(evidence, now).nodes.alerts.status).toBe("degraded");
  });
});
