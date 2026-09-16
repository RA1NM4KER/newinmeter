import { describe, expect, it } from "vitest";
import {
  classifyCanaryHealth,
  classifyConnectionHealth,
  classifySchedulerHealth,
  type ConnectionHealthInput
} from "./health";

const now = new Date("2026-08-26T12:00:00.000Z");

function connection(overrides: Partial<ConnectionHealthInput> = {}): ConnectionHealthInput {
  return {
    status: "connected",
    connectedAt: "2026-08-20T12:00:00.000Z",
    autoSyncEnabled: true,
    nextSyncAt: "2026-08-26T13:00:00.000Z",
    lastSuccessfulSyncAt: "2026-08-26T10:00:00.000Z",
    lastAttemptStatus: "success",
    lastAutoSyncStatus: "success",
    syncClaimedAt: null,
    consecutiveFailures: 0,
    dataState: "warm",
    hibernationError: null,
    ...overrides
  };
}

describe("diagnostics health classification", () => {
  it("does not escalate one transient sync failure to critical", () => {
    expect(
      classifyConnectionHealth(connection({ consecutiveFailures: 1, lastAttemptStatus: "failed" }), now).state
    ).toBe("warning");
  });

  it("classifies repeated sync failures as critical", () => {
    const result = classifyConnectionHealth(connection({ consecutiveFailures: 3 }), now);
    expect(result.state).toBe("critical");
    expect(result.reason).toMatch(/3 consecutive/i);
  });

  it("classifies a stuck scheduler claim as critical", () => {
    expect(classifyConnectionHealth(connection({ syncClaimedAt: "2026-08-26T11:40:00.000Z" }), now).state).toBe(
      "critical"
    );
  });

  it("treats a cold connection as healthy instead of flagging stale sync", () => {
    const result = classifyConnectionHealth(
      connection({ dataState: "cold", lastSuccessfulSyncAt: "2026-06-01T00:00:00.000Z", nextSyncAt: null }),
      now
    );
    expect(result.state).toBe("healthy");
  });

  it("treats a hibernating connection as a warning, not a stale-sync critical", () => {
    const result = classifyConnectionHealth(connection({ dataState: "hibernating" }), now);
    expect(result.state).toBe("warning");
  });

  it("escalates a hibernating connection with a purge error to critical", () => {
    const result = classifyConnectionHealth(
      connection({ dataState: "hibernating", hibernationError: "statement timeout" }),
      now
    );
    expect(result.state).toBe("critical");
    expect(result.reason).toContain("statement timeout");
  });

  it("classifies a failed restoration as critical", () => {
    expect(classifyConnectionHealth(connection({ dataState: "restore_failed" }), now).state).toBe("critical");
  });

  it("uses the five-minute scheduler heartbeat without over-alerting on a short delay", () => {
    expect(classifySchedulerHealth("2026-08-26T11:50:00.000Z", now).state).toBe("healthy");
    expect(classifySchedulerHealth("2026-08-26T11:40:00.000Z", now)).toEqual({
      state: "warning",
      reason: "Last scheduler check-in was 20 minutes ago."
    });
    expect(classifySchedulerHealth("2026-08-26T11:20:00.000Z", now).state).toBe("critical");
  });

  it("keeps a retry-recovered canary warning distinct from a final failure", () => {
    expect(classifyCanaryHealth("warning", "2026-08-26T11:00:00.000Z", "2026-08-26T11:00:00.000Z", now).state).toBe(
      "warning"
    );
    expect(classifyCanaryHealth("critical", "2026-08-26T11:00:00.000Z", "2026-08-25T11:00:00.000Z", now).state).toBe(
      "critical"
    );
  });
});
