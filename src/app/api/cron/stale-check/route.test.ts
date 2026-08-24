import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCronSecret: vi.fn(),
  listConnectionsForStaleCheck: vi.fn(),
  markConnectionStaleNotified: vi.fn(),
  sendPushToUser: vi.fn(),
  evaluateDataDelayedAlerts: vi.fn()
}));

vi.mock("@/lib/env", () => ({ getCronSecret: mocks.getCronSecret }));
vi.mock("@/lib/newinmeter/connection", () => ({
  listConnectionsForStaleCheck: mocks.listConnectionsForStaleCheck,
  markConnectionStaleNotified: mocks.markConnectionStaleNotified
}));
vi.mock("@/lib/push-notify", () => ({ sendPushToUser: mocks.sendPushToUser }));
vi.mock("@/lib/newinmeter/alerts", () => ({ evaluateDataDelayedAlerts: mocks.evaluateDataDelayedAlerts }));

import { GET } from "./route";

const CRON_SECRET = "test-cron-secret";

function request() {
  return new Request("http://localhost/api/cron/stale-check", {
    headers: { authorization: `Bearer ${CRON_SECRET}` }
  });
}

describe("GET /api/cron/stale-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCronSecret.mockReturnValue(CRON_SECRET);
    mocks.markConnectionStaleNotified.mockResolvedValue(undefined);
    mocks.sendPushToUser.mockResolvedValue(0);
  });

  it("evaluates data_delayed alerts for the same connections it checked for staleness, and includes the result", async () => {
    const connections = [
      { id: "conn-a", userId: "user-a", lastSyncedAt: null, staleNotifiedAt: null },
      { id: "conn-b", userId: "user-b", lastSyncedAt: new Date().toISOString(), staleNotifiedAt: null }
    ];
    mocks.listConnectionsForStaleCheck.mockResolvedValue(connections);
    mocks.evaluateDataDelayedAlerts.mockResolvedValue({ checked: 1, notified: 1 });

    const response = await GET(request());
    const body = await response.json();

    expect(mocks.evaluateDataDelayedAlerts).toHaveBeenCalledWith([
      { connectionId: "conn-a", userId: "user-a", lastSyncedAt: null },
      { connectionId: "conn-b", userId: "user-b", lastSyncedAt: connections[1].lastSyncedAt }
    ]);
    expect(body.dataDelayedAlerts).toEqual({ checked: 1, notified: 1 });
  });

  it("rejects a request without the correct bearer secret", async () => {
    const response = await GET(new Request("http://localhost/api/cron/stale-check"));
    expect(response.status).toBe(401);
    expect(mocks.listConnectionsForStaleCheck).not.toHaveBeenCalled();
  });
});
