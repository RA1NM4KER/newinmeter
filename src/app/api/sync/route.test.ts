import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireConnectedSession: vi.fn(),
  loadDashboardSummary: vi.fn(),
  getConnectionRowForUser: vi.fn(),
  getDecryptedRefreshToken: vi.fn(),
  markConnectionAuthError: vi.fn(),
  markConnectionSyncOutcome: vi.fn(),
  replaceConnectionRefreshToken: vi.fn(),
  runLivemopaySync: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireConnectedSession: mocks.requireConnectedSession }));
vi.mock("@/lib/dashboard-data", () => ({ loadDashboardSummary: mocks.loadDashboardSummary }));
vi.mock("@/lib/newinmeter-connection", () => ({
  getConnectionRowForUser: mocks.getConnectionRowForUser,
  getDecryptedRefreshToken: mocks.getDecryptedRefreshToken,
  markConnectionAuthError: mocks.markConnectionAuthError,
  markConnectionSyncOutcome: mocks.markConnectionSyncOutcome,
  replaceConnectionRefreshToken: mocks.replaceConnectionRefreshToken
}));
vi.mock("@/lib/newinmeter-sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter-sync")>("@/lib/newinmeter-sync");
  return { ...actual, runLivemopaySync: mocks.runLivemopaySync };
});

import { POST } from "./route";

const session = { userId: "user-a", accessToken: "token", connection: { id: "connection-a" } };

const connectedRow = {
  id: "connection-a",
  status: "connected",
  account_id: "acc",
  company_id: "co",
  property_id: "prop",
  is_demo: false
};

function request(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/sync", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireConnectedSession.mockResolvedValue({ ok: true, session });
    mocks.loadDashboardSummary.mockResolvedValue({});
    mocks.markConnectionSyncOutcome.mockResolvedValue(undefined);
  });

  it("never decrypts a token or calls runLivemopaySync for a demo connection", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue({ ...connectedRow, is_demo: true });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ demoAccount: true });
    expect(mocks.getDecryptedRefreshToken).not.toHaveBeenCalled();
    expect(mocks.runLivemopaySync).not.toHaveBeenCalled();
  });

  it("syncs normally for a real, non-demo connection", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue(connectedRow);
    mocks.getDecryptedRefreshToken.mockReturnValue("refresh-token");
    mocks.runLivemopaySync.mockResolvedValue({ output: "ok" });

    const response = await POST(request({ mode: "incremental" }));

    expect(response.status).toBe(200);
    expect(mocks.getDecryptedRefreshToken).toHaveBeenCalledWith(connectedRow);
    expect(mocks.runLivemopaySync).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "connection-a", refreshToken: "refresh-token" })
    );
    expect(mocks.markConnectionSyncOutcome).toHaveBeenCalledWith("connection-a", null);
  });

  it("requires a connected session", async () => {
    mocks.requireConnectedSession.mockResolvedValue({ ok: false, status: 409 });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.getConnectionRowForUser).not.toHaveBeenCalled();
  });
});
