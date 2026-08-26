import { describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
import { DIAGNOSTIC_CONNECTION_SELECT, diagnosticsSnapshotToJson, type DiagnosticsSnapshot } from "./data";

describe("diagnostics serialization boundary", () => {
  it("never selects connection credential or upstream identity columns", () => {
    expect(DIAGNOSTIC_CONNECTION_SELECT).not.toMatch(
      /refresh_token|ciphertext|auth_tag|\baccount_id\b|\bproperty_id\b|\bdevice_id\b|\bcompany_id\b|password/i
    );
  });

  it("serializes only the explicit safe diagnostics DTO", () => {
    const snapshot: DiagnosticsSnapshot = {
      generatedAt: "2026-08-26T12:00:00.000Z",
      overview: {
        overall: "healthy",
        livemopay: "healthy",
        livemopayReason: "Passed",
        scheduler: "healthy",
        schedulerReason: "On time",
        schedulerLastInvocationAt: null,
        schedulerExpectedMinutes: 5,
        connectionCount: 0,
        healthyConnections: 0,
        needsAttentionConnections: 0,
        unresolvedCriticalEvents: 0,
        lastApiContractCheckAt: null,
        lastApiContractSuccessAt: null,
        activePushSubscriptions: 0,
        pushStatus: null
      },
      connections: [],
      events: []
    };
    const json = diagnosticsSnapshotToJson(snapshot);
    expect(json).not.toMatch(/password|refreshToken|ciphertext|authTag|accountId|propertyId|deviceId|cronSecret/i);
  });
});
