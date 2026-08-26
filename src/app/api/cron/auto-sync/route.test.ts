import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCronSecret: vi.fn(),
  claimDueAutoSyncConnections: vi.fn(),
  markAutoSyncSuccess: vi.fn(),
  markAutoSyncFailure: vi.fn(),
  markConnectionAuthError: vi.fn(),
  releaseAutoSyncClaim: vi.fn(),
  replaceConnectionRefreshToken: vi.fn(),
  runLivemopaySync: vi.fn(),
  decryptRefreshToken: vi.fn(),
  evaluateAlertsAfterSync: vi.fn(),
  reportSuccess: vi.fn(),
  reportFailure: vi.fn(),
  reportReauth: vi.fn(),
  reportBroad: vi.fn(),
  recordScheduler: vi.fn()
}));

vi.mock("@/lib/env", () => ({ getCronSecret: mocks.getCronSecret }));
vi.mock("@/lib/newinmeter/alerts", () => ({ evaluateAlertsAfterSync: mocks.evaluateAlertsAfterSync }));
vi.mock("@/lib/diagnostics/operations", () => ({
  reportConnectionSyncSuccess: mocks.reportSuccess,
  reportConnectionSyncFailure: mocks.reportFailure,
  reportConnectionReauthenticationRequired: mocks.reportReauth,
  reportBroadSyncOutcome: mocks.reportBroad,
  recordSchedulerInvocation: mocks.recordScheduler
}));
vi.mock("@/lib/newinmeter/connection", () => ({
  claimDueAutoSyncConnections: mocks.claimDueAutoSyncConnections,
  markAutoSyncSuccess: mocks.markAutoSyncSuccess,
  markAutoSyncFailure: mocks.markAutoSyncFailure,
  markConnectionAuthError: mocks.markConnectionAuthError,
  releaseAutoSyncClaim: mocks.releaseAutoSyncClaim,
  replaceConnectionRefreshToken: mocks.replaceConnectionRefreshToken
}));
vi.mock("@/lib/newinmeter/sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/sync")>("@/lib/newinmeter/sync");
  return { ...actual, runLivemopaySync: mocks.runLivemopaySync };
});
vi.mock("@/lib/token-encryption", async () => {
  const actual = await vi.importActual<typeof import("@/lib/token-encryption")>("@/lib/token-encryption");
  return { ...actual, decryptRefreshToken: mocks.decryptRefreshToken };
});

import { SyncAlreadyRunningError } from "@/lib/newinmeter/sync";
import { TokenDecryptionError } from "@/lib/token-encryption";
import { POST } from "./route";

const CRON_SECRET = "test-cron-secret";

function connection(id: string) {
  return {
    id,
    userId: `user-${id}`,
    accountId: "acc",
    companyId: "co",
    propertyId: "prop",
    refreshTokenCiphertext: "cipher",
    refreshTokenIv: "iv",
    refreshTokenAuthTag: "tag"
  };
}

function request(headers: Record<string, string> = { authorization: `Bearer ${CRON_SECRET}` }) {
  return new Request("http://localhost/api/cron/auto-sync", { method: "POST", headers });
}

describe("POST /api/cron/auto-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCronSecret.mockReturnValue(CRON_SECRET);
    mocks.decryptRefreshToken.mockReturnValue("plain-refresh-token");
    mocks.markAutoSyncSuccess.mockResolvedValue(undefined);
    mocks.markAutoSyncFailure.mockResolvedValue(undefined);
    mocks.markConnectionAuthError.mockResolvedValue(undefined);
    mocks.releaseAutoSyncClaim.mockResolvedValue(undefined);
    mocks.evaluateAlertsAfterSync.mockResolvedValue(undefined);
    mocks.reportSuccess.mockResolvedValue(undefined);
    mocks.reportFailure.mockResolvedValue(undefined);
    mocks.reportReauth.mockResolvedValue(undefined);
    mocks.reportBroad.mockResolvedValue(undefined);
    mocks.recordScheduler.mockResolvedValue(undefined);
  });

  it("rejects a request without the correct bearer secret", async () => {
    const response = await POST(request({ authorization: "Bearer wrong" }));
    expect(response.status).toBe(401);
    expect(mocks.claimDueAutoSyncConnections).not.toHaveBeenCalled();
  });

  it("rejects a request with no authorization header at all", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(401);
    expect(mocks.claimDueAutoSyncConnections).not.toHaveBeenCalled();
  });

  it("does nothing and never calls runLivemopaySync when nothing is claimed", async () => {
    mocks.claimDueAutoSyncConnections.mockResolvedValue([]);
    const response = await POST(request());
    const body = await response.json();

    expect(body).toMatchObject({ ok: true, claimed: 0 });
    expect(mocks.runLivemopaySync).not.toHaveBeenCalled();
  });

  it("one claimed connection failing does not abort the others in the same batch", async () => {
    mocks.claimDueAutoSyncConnections.mockResolvedValue([connection("a"), connection("b"), connection("c")]);
    mocks.runLivemopaySync.mockImplementation(async ({ connectionId }: { connectionId: string }) => {
      if (connectionId === "b") {
        throw new Error("upstream 500");
      }
      return { mode: "incremental", output: "ok", rowsSynced: 1 };
    });

    const response = await POST(request());
    const body = await response.json();

    expect(mocks.runLivemopaySync).toHaveBeenCalledTimes(3);
    expect(mocks.markAutoSyncSuccess).toHaveBeenCalledWith("a");
    expect(mocks.markAutoSyncSuccess).toHaveBeenCalledWith("c");
    expect(mocks.markAutoSyncFailure).toHaveBeenCalledWith("b", "upstream 500");
    expect(body).toMatchObject({ claimed: 3, success: 2, retryable: 1 });
  });

  it("records success and passes incremental mode with the correct connection fields", async () => {
    mocks.claimDueAutoSyncConnections.mockResolvedValue([connection("a")]);
    mocks.runLivemopaySync.mockResolvedValue({ mode: "incremental", output: "ok", rowsSynced: 1 });

    await POST(request());

    expect(mocks.runLivemopaySync).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "a",
        accountId: "acc",
        companyId: "co",
        propertyId: "prop",
        refreshToken: "plain-refresh-token",
        mode: "incremental",
        trigger: "auto"
      })
    );
    expect(mocks.markAutoSyncSuccess).toHaveBeenCalledWith("a");
    expect(mocks.markAutoSyncFailure).not.toHaveBeenCalled();
    expect(mocks.evaluateAlertsAfterSync).toHaveBeenCalledWith("a", "user-a");
  });

  it("does not evaluate alerts for a connection that fails", async () => {
    mocks.claimDueAutoSyncConnections.mockResolvedValue([connection("a")]);
    mocks.runLivemopaySync.mockRejectedValue(new Error("upstream 500"));

    await POST(request());

    expect(mocks.markAutoSyncFailure).toHaveBeenCalledWith("a", "upstream 500");
    expect(mocks.evaluateAlertsAfterSync).not.toHaveBeenCalled();
  });

  it("releases the claim without recording a failure on SyncAlreadyRunningError", async () => {
    mocks.claimDueAutoSyncConnections.mockResolvedValue([connection("a")]);
    mocks.runLivemopaySync.mockRejectedValue(new SyncAlreadyRunningError());

    const response = await POST(request());
    const body = await response.json();

    expect(mocks.releaseAutoSyncClaim).toHaveBeenCalledWith("a");
    expect(mocks.markAutoSyncFailure).not.toHaveBeenCalled();
    expect(mocks.markAutoSyncSuccess).not.toHaveBeenCalled();
    expect(body).toMatchObject({ alreadyRunning: 1 });
  });

  it("marks the connection as needing reauth on TokenDecryptionError, not as a retryable failure", async () => {
    mocks.claimDueAutoSyncConnections.mockResolvedValue([connection("a")]);
    mocks.decryptRefreshToken.mockImplementation(() => {
      throw new TokenDecryptionError(new Error("bad auth tag"));
    });

    const response = await POST(request());
    const body = await response.json();

    expect(mocks.markConnectionAuthError).toHaveBeenCalledWith("a");
    expect(mocks.markAutoSyncFailure).not.toHaveBeenCalled();
    expect(mocks.runLivemopaySync).not.toHaveBeenCalled();
    expect(body).toMatchObject({ authError: 1 });
  });
});
