import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapEvidence, MAP_TEST_TIME } from "../../../test/system-map-fixture";
const mocks = vi.hoisted(() => ({ diagnostics: vi.fn(), states: vi.fn(), unresolved: vi.fn() }));
vi.mock("react", async () => ({
  ...(await vi.importActual<typeof import("react")>("react")),
  cache: <T>(fn: T) => fn
}));
vi.mock("../diagnostics/data", () => ({ getDiagnosticsSnapshot: mocks.diagnostics }));
vi.mock("../diagnostics/store", async () => ({
  ...(await vi.importActual<typeof import("../diagnostics/store")>("../diagnostics/store")),
  getSystemHealthStates: mocks.states,
  listUnresolvedSystemEvents: mocks.unresolved
}));
import { getSystemMapSnapshot } from "./data";

describe("system map serialization boundary", () => {
  beforeEach(() => vi.resetAllMocks());
  it("uses older unresolved incidents without exposing raw metadata or identities", async () => {
    const evidence = mapEvidence();
    mocks.diagnostics.mockResolvedValue(evidence.diagnostics);
    mocks.states.mockResolvedValue(
      evidence.states.map((state) => ({ ...state, details: { token: "raw-state-secret" } }))
    );
    mocks.unresolved.mockResolvedValue([
      {
        id: "old-event",
        createdAt: MAP_TEST_TIME,
        severity: "warning",
        category: "alerts",
        eventType: "alert_evaluation_failed",
        connectionId: "private-connection",
        message: "Failed for person@example.com token=raw-token",
        resolvedAt: null,
        metadata: { secret: "raw-event-secret" },
        incidentKey: "private-key"
      }
    ]);
    const result = await getSystemMapSnapshot();
    expect(result.nodes.alerts.status).toBe("degraded");
    expect(result.nodes.alerts.events[0].message).toContain("<redacted");
    expect(JSON.stringify(result)).not.toMatch(
      /raw-state-secret|raw-event-secret|raw-token|person@example|private-connection|private-key|private@example/
    );
  });
});
