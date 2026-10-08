import { describe, expect, it } from "vitest";
import { buildSystemMap } from "./resolve";
import { isMapStale, systemMapSnapshotSchema } from "./model";
import { SYSTEM_EDGES, SYSTEM_NODES } from "./topology";
import { mapConnection, mapEvidence, MAP_TEST_TIME } from "../../../test/system-map-fixture";
const now = new Date(MAP_TEST_TIME);

describe("system map health evidence", () => {
  it("keeps unmeasured services unknown and limits healthy claims to actual evidence", () => {
    const map = buildSystemMap(mapEvidence(), now);
    for (const id of ["auth", "ai", "cron", "client", "alerts"]) expect(map.nodes[id].status).toBe("unknown");
    for (const id of ["livemopay", "session", "scheduler", "sync", "database", "rollups", "push"])
      expect(map.nodes[id].status).toBe("healthy");
    expect(map.edges["push-client"].status).toBe("unknown");
    expect(map.edges["alerts-push"].status).toBe("unknown");
    expect(map.nodes.database.reason).toContain("read succeeded");
    expect(map.edges["ledger-sync"].metrics).toContainEqual({
      label: "Latest run duration (whole pipeline)",
      value: "10.0 s"
    });
  });

  it("infers the provider session from sync and canary successes and never marks it failed", () => {
    const healthy = buildSystemMap(mapEvidence(), now);
    expect(healthy.nodes.session.status).toBe("healthy");
    expect(healthy.nodes.session.reason).toContain("Inferred from");

    const evidence = mapEvidence();
    evidence.diagnostics.overview.livemopay = "critical";
    evidence.diagnostics.connections.forEach((connection) => (connection.lastSuccessfulSyncAt = null));
    const failing = buildSystemMap(evidence, now);
    expect(failing.nodes.session.status).toBe("unknown");
  });

  it("separates a failed provider from potential sync and ingestion impact", () => {
    const evidence = mapEvidence();
    evidence.diagnostics.overview.livemopay = "critical";
    evidence.diagnostics.overview.needsAttentionConnections = 1;
    const map = buildSystemMap(evidence, now);
    expect(map.nodes.livemopay.status).toBe("failed");
    expect(map.nodes.sync.status).toBe("affected");
    expect(map.nodes.sync.affectedBy).toEqual(["livemopay"]);
    expect(map.nodes.sync.reason).toContain("connections need attention");
    expect(map.edges["sync-database"].status).toBe("affected");
    expect(map.nodes.database.status).toBe("healthy");
    expect(map.nodes.auth.status).toBe("unknown");
  });

  it("does not attribute an independent alert failure to unrelated upstream outages", () => {
    const evidence = mapEvidence();
    evidence.diagnostics.overview.livemopay = "critical";
    evidence.events.push({
      id: "incident",
      createdAt: MAP_TEST_TIME,
      category: "alerts",
      eventType: "alert_evaluation_failed",
      severity: "critical",
      message: "Evaluation failed",
      resolvedAt: null,
      connectionId: "connection-1"
    });
    const map = buildSystemMap(evidence, now);
    expect(map.nodes.alerts.status).toBe("failed");
    expect(map.nodes.alerts.affectedBy).toEqual([]);
    expect(map.nodes.push.affectedBy).toEqual(["alerts"]);
  });

  it("does not call silent event-driven push or an old provider check healthy", () => {
    const evidence = mapEvidence();
    const later = new Date(now.getTime() + 49 * 3_600_000);
    const map = buildSystemMap(evidence, later);
    expect(map.nodes.livemopay.status).toBe("unknown");
    expect(map.nodes.push.status).toBe("unknown");
    expect(map.nodes.rollups.status).toBe("unknown");
  });

  it("does not interpret zero connections or dormant accounts as a successful sync", () => {
    const evidence = mapEvidence();
    evidence.diagnostics.connections = [];
    evidence.diagnostics.overview.connectionCount = 0;
    expect(buildSystemMap(evidence, now).nodes.sync.status).toBe("unknown");
    evidence.diagnostics.connections = [
      mapConnection({ dataState: "cold", lastSuccessfulSyncAt: null, lastAttemptAt: null, recentRuns: [] })
    ];
    expect(buildSystemMap(evidence, now).nodes.sync.status).toBe("unknown");
  });

  it("marks missing scheduler telemetry unknown, not a confirmed service outage", () => {
    const evidence = mapEvidence();
    evidence.diagnostics.overview.schedulerLastInvocationAt = null;
    evidence.diagnostics.overview.scheduler = "critical";
    expect(buildSystemMap(evidence, now).nodes.scheduler.status).toBe("unknown");
  });

  it("retains unresolved incidents outside the recent window and clears resolved failures", () => {
    const evidence = mapEvidence();
    evidence.events.push({
      id: "old-alert",
      createdAt: "2026-09-01T00:00:00.000Z",
      category: "alerts",
      eventType: "alert_evaluation_failed",
      severity: "warning",
      message: "Evaluation failed",
      resolvedAt: null,
      connectionId: null
    });
    expect(buildSystemMap(evidence, now).nodes.alerts.status).toBe("degraded");
    evidence.events.push(
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `recovery-${index}`,
        createdAt: MAP_TEST_TIME,
        category: "alerts",
        eventType: "recovered",
        severity: "info" as const,
        message: "Recovered",
        resolvedAt: MAP_TEST_TIME,
        connectionId: null
      }))
    );
    expect(buildSystemMap(evidence, now).nodes.alerts.events[0].id).toBe("old-alert");
    evidence.events[0].resolvedAt = MAP_TEST_TIME;
    expect(buildSystemMap(evidence, now).nodes.alerts.status).toBe("unknown");
  });

  it("does not leak connection identities or retain impact after recovery", () => {
    const evidence = mapEvidence();
    evidence.diagnostics.overview.scheduler = "critical";
    const failing = buildSystemMap(evidence, now);
    expect(failing.nodes.sync.affectedBy).toEqual(["scheduler"]);
    evidence.diagnostics.overview.scheduler = "healthy";
    const recovered = buildSystemMap(evidence, now);
    expect(recovered.nodes.sync.affectedBy).toEqual([]);
    expect(JSON.stringify(recovered)).not.toMatch(/private@example|Private household|connection-1/);
  });

  it("validates complete topology and snapshot freshness at the client boundary", () => {
    const map = buildSystemMap(mapEvidence(), now);
    expect(systemMapSnapshotSchema.safeParse(map).success).toBe(true);
    expect(new Set(SYSTEM_NODES.map((node) => node.id)).size).toBe(SYSTEM_NODES.length);
    expect(new Set(SYSTEM_EDGES.map((edge) => edge.id)).size).toBe(SYSTEM_EDGES.length);
    for (const edge of SYSTEM_EDGES) {
      expect(map.nodes[edge.from]).toBeDefined();
      expect(map.nodes[edge.to]).toBeDefined();
    }
    expect(isMapStale(map, now.getTime() + 120_001)).toBe(true);
    expect(isMapStale(map, now.getTime() + 45_000)).toBe(false);
    expect(isMapStale(map, now.getTime() - 60_000)).toBe(true);
    map.nodes.sync.observedAt = "2026-10-07T12:00:00+00:00";
    expect(systemMapSnapshotSchema.safeParse(map).success).toBe(true);
    delete map.nodes.sync;
    expect(systemMapSnapshotSchema.safeParse(map).success).toBe(false);
  });
});
