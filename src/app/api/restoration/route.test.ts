import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rate: vi.fn(),
  requestRestore: vi.fn(),
  getRow: vi.fn(),
  decrypt: vi.fn(),
  runSync: vi.fn(),
  replaceToken: vi.fn(),
  markOutcome: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  markAuthError: vi.fn()
}));

const errors = vi.hoisted(() => ({
  InvalidRefreshTokenError: class InvalidRefreshTokenError extends Error {},
  AlreadyRunningError: class AlreadyRunningError extends Error {}
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.session }));
vi.mock("@/lib/rate-limit", () => ({ limitUserRequest: mocks.rate }));
vi.mock("@/lib/newinmeter/connection", () => ({
  requestConnectionRestore: mocks.requestRestore,
  getConnectionRowForUser: mocks.getRow,
  getDecryptedRefreshToken: mocks.decrypt,
  replaceConnectionRefreshToken: mocks.replaceToken,
  markConnectionSyncOutcome: mocks.markOutcome,
  completeConnectionRestore: mocks.complete,
  failConnectionRestore: mocks.fail,
  markConnectionAuthError: mocks.markAuthError
}));
vi.mock("@/lib/newinmeter/sync", () => ({
  runLivemopaySync: mocks.runSync,
  SyncAlreadyRunningError: errors.AlreadyRunningError
}));
vi.mock("@/lib/newinmeter/web", () => ({ LiveMopayRefreshTokenInvalidError: errors.InvalidRefreshTokenError }));

import { POST } from "./route";

const row = {
  id: "conn-a",
  account_id: "account",
  company_id: "company",
  property_id: "property",
  data_state: "restoring",
  status: "connected",
  refresh_token_ciphertext: "cipher"
};

describe("POST /api/restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ userId: "user-a", accessToken: "access", email: "a@example.com" });
    mocks.rate.mockResolvedValue({ headers: {}, response: null });
    mocks.requestRestore.mockResolvedValue({ connectionId: "conn-a", dataState: "restoring", shouldStart: true });
    mocks.getRow.mockResolvedValue(row);
    mocks.decrypt.mockReturnValue("refresh");
    mocks.runSync.mockResolvedValue({ rowsSynced: 10 });
    mocks.replaceToken.mockResolvedValue(undefined);
    mocks.markOutcome.mockResolvedValue(undefined);
    mocks.complete.mockResolvedValue(undefined);
    mocks.fail.mockResolvedValue(undefined);
    mocks.markAuthError.mockResolvedValue(undefined);
  });

  it("does not start duplicate work when another request already transitioned the connection", async () => {
    mocks.requestRestore.mockResolvedValue({ connectionId: "conn-a", dataState: "restoring", shouldStart: false });

    const response = await POST();

    expect(response.status).toBe(202);
    expect(mocks.getRow).not.toHaveBeenCalled();
    expect(mocks.runSync).not.toHaveBeenCalled();
  });

  it("restores an explicit recent window and marks warm only after sync success", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.runSync).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "conn-a", mode: "restore", trigger: "restore" })
    );
    expect(mocks.markOutcome).toHaveBeenCalledWith("conn-a", null);
    expect(mocks.complete).toHaveBeenCalledWith("conn-a");
    await expect(response.json()).resolves.toMatchObject({ dataState: "warm", started: true });
  });

  it("turns an expired refresh token into a reconnect action", async () => {
    mocks.runSync.mockRejectedValue(new errors.InvalidRefreshTokenError("expired"));

    const response = await POST();

    expect(response.status).toBe(409);
    expect(mocks.markAuthError).toHaveBeenCalledWith("conn-a");
    expect(mocks.complete).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ reconnectRequired: true });
  });

  it("records a retryable failure and allows a later claimed retry to succeed", async () => {
    mocks.runSync.mockRejectedValueOnce(new Error("upstream unavailable")).mockResolvedValueOnce({ rowsSynced: 10 });

    const failed = await POST();
    expect(failed.status).toBe(500);
    expect(mocks.fail).toHaveBeenCalledWith("conn-a", "upstream unavailable");

    const retried = await POST();
    expect(retried.status).toBe(200);
    expect(mocks.runSync).toHaveBeenCalledTimes(2);
    expect(mocks.complete).toHaveBeenCalledWith("conn-a");
  });
});
