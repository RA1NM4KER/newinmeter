import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminSupabaseFetch: vi.fn(),
  adminSupabaseRequest: vi.fn(),
  deleteUser: vi.fn()
}));

vi.mock("../supabase-rest", () => ({
  adminSupabaseFetch: mocks.adminSupabaseFetch,
  adminSupabaseRequest: mocks.adminSupabaseRequest
}));
// React's cache() is a React 19 API. Next 14 resolves "react" to its own
// vendored canary build at RSC-compile time (where connection.ts's
// getConnectionForUser actually runs in production), but plain Node/vitest
// resolution hits the real installed react@18.3.1, which has no cache
// export -- connection.ts would throw on import before a single test could
// run. Stubbed as identity (no memoization) purely so this file can import
// the real module; it doesn't affect what's under test here since none of
// these tests exercise getConnectionForUser's memoization behavior.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("../supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { deleteUser: mocks.deleteUser } } })
}));
vi.mock("../token-encryption", () => ({
  encryptRefreshToken: () => ({ ciphertext: "c", iv: "i", authTag: "t" }),
  decryptRefreshToken: () => "plain-refresh-token"
}));

import {
  beginLivemopayConnection,
  claimDueAutoSyncConnections,
  DemoAccountProtectedError,
  deleteAccountForUser,
  disconnectLivemopayConnection,
  listConnectionsForStaleCheck,
  markAutoSyncFailure,
  markAutoSyncSuccess,
  releaseAutoSyncClaim,
  setAutoSyncEnabled
} from "./connection";

const demoRow = {
  id: "conn-demo",
  user_id: "user-demo",
  livemopay_email: "demo.recruiter@newinmeter.invalid",
  firebase_local_id: null,
  account_id: "demo-account-001",
  company_id: "demo-company-001",
  property_id: "demo-property-001",
  account_label: "Demo Property",
  refresh_token_ciphertext: null,
  refresh_token_iv: null,
  refresh_token_auth_tag: null,
  pending_accounts: null,
  status: "connected",
  connected_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  last_synced_at: null,
  last_error: null,
  is_demo: true
};

const realRow = { ...demoRow, id: "conn-real", user_id: "user-real", is_demo: false };

describe("newinmeter-connection demo protections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to disconnect a demo connection", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([demoRow]);
    await expect(disconnectLivemopayConnection("user-demo")).rejects.toBeInstanceOf(DemoAccountProtectedError);
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("disconnects a real connection normally", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([realRow]);
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);
    await expect(disconnectLivemopayConnection("user-real")).resolves.toBeUndefined();
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      expect.stringContaining("conn-real"),
      expect.objectContaining({ status: "disconnected" }),
      "return=minimal"
    );
  });

  it("refuses to delete a demo account", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([demoRow]);
    await expect(deleteAccountForUser("user-demo")).rejects.toBeInstanceOf(DemoAccountProtectedError);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes a real account normally", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([realRow]);
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);
    mocks.deleteUser.mockResolvedValue({ error: null });
    await expect(deleteAccountForUser("user-real")).resolves.toBeUndefined();
    expect(mocks.deleteUser).toHaveBeenCalledWith("user-real");
  });

  it("refuses to attach real LiveMopay credentials to a demo connection", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([demoRow]);
    await expect(
      beginLivemopayConnection({
        userId: "user-demo",
        livemopayEmail: "real@example.com",
        refreshToken: "real-refresh-token",
        candidates: [{ accountId: "a", companyId: "b", propertyId: "c", label: "Real" }]
      })
    ).rejects.toBeInstanceOf(DemoAccountProtectedError);
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("connects normally when there is no existing connection", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([]);
    mocks.adminSupabaseRequest.mockResolvedValue([{ ...realRow, status: "connected" }]);
    const result = await beginLivemopayConnection({
      userId: "user-real",
      livemopayEmail: "real@example.com",
      refreshToken: "real-refresh-token",
      candidates: [{ accountId: "a", companyId: "b", propertyId: "c", label: "Real" }]
    });
    expect(result.status).toBe("connected");
  });

  it("excludes demo connections from the stale-check query", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([]);
    await listConnectionsForStaleCheck();
    expect(mocks.adminSupabaseFetch).toHaveBeenCalledWith(expect.stringContaining("is_demo=eq.false"));
  });
});

const autoSyncRow = {
  ...realRow,
  id: "conn-auto",
  user_id: "user-auto",
  status: "connected",
  auto_sync_enabled: true,
  next_sync_at: null,
  last_auto_sync_at: null,
  last_auto_sync_status: null,
  last_auto_sync_error: null,
  sync_claimed_at: null,
  alerts_enabled: false
};

describe("newinmeter-connection auto-sync scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("turning automatic updates on assigns a future next_sync_at for a connected account", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([{ ...autoSyncRow, auto_sync_enabled: false }]);
    mocks.adminSupabaseRequest.mockResolvedValue([{ ...autoSyncRow, auto_sync_enabled: true, next_sync_at: "future" }]);

    await setAutoSyncEnabled("user-auto", true);

    const [, , payload] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(payload.auto_sync_enabled).toBe(true);
    expect(payload.next_sync_at).not.toBeNull();
    expect(new Date(payload.next_sync_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("turning automatic updates off clears next_sync_at", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([autoSyncRow]);
    mocks.adminSupabaseRequest.mockResolvedValue([{ ...autoSyncRow, auto_sync_enabled: false, next_sync_at: null }]);

    await setAutoSyncEnabled("user-auto", false);

    const [, , payload] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(payload).toMatchObject({ auto_sync_enabled: false, next_sync_at: null });
  });

  it("enabling automatic updates on a disconnected account does not schedule it", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([{ ...autoSyncRow, status: "disconnected" }]);
    mocks.adminSupabaseRequest.mockResolvedValue([{ ...autoSyncRow, status: "disconnected" }]);

    await setAutoSyncEnabled("user-auto", true);

    const [, , payload] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(payload).toMatchObject({ auto_sync_enabled: true, next_sync_at: null });
  });

  it("refuses to change auto-sync for a demo connection", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([{ ...autoSyncRow, is_demo: true }]);
    await expect(setAutoSyncEnabled("user-auto", true)).rejects.toBeInstanceOf(DemoAccountProtectedError);
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("claims due connections through the RPC and maps the returned rows", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([
      {
        id: "conn-auto",
        user_id: "user-auto",
        account_id: "a",
        company_id: "b",
        property_id: "c",
        refresh_token_ciphertext: "cipher",
        refresh_token_iv: "iv",
        refresh_token_auth_tag: "tag"
      }
    ]);

    const claimed = await claimDueAutoSyncConnections(5, 10);

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/rpc/claim_due_auto_sync_connections",
      { p_limit: 5, p_claim_ttl: "10 minutes" }
    );
    expect(claimed).toEqual([
      {
        id: "conn-auto",
        userId: "user-auto",
        accountId: "a",
        companyId: "b",
        propertyId: "c",
        refreshTokenCiphertext: "cipher",
        refreshTokenIv: "iv",
        refreshTokenAuthTag: "tag"
      }
    ]);
  });

  it("records success with a future next_sync_at and releases the claim", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);
    await markAutoSyncSuccess("conn-auto");

    const [, , payload] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(payload.last_auto_sync_status).toBe("success");
    expect(payload.sync_claimed_at).toBeNull();
    expect(payload.last_error).toBeNull();
    expect(new Date(payload.next_sync_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("records a retryable failure with a modest backoff and releases the claim", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);
    const before = Date.now();
    await markAutoSyncFailure("conn-auto", "network blip");

    const [, , payload] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(payload.last_auto_sync_status).toBe("failed");
    expect(payload.last_auto_sync_error).toBe("network blip");
    expect(payload.sync_claimed_at).toBeNull();
    const minutesAhead = (new Date(payload.next_sync_at).getTime() - before) / 60_000;
    expect(minutesAhead).toBeGreaterThan(5);
    expect(minutesAhead).toBeLessThanOrEqual(60);
  });

  it("releasing a claim only clears sync_claimed_at, leaving next_sync_at untouched", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);
    await releaseAutoSyncClaim("conn-auto");

    const [, , payload] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(payload).toEqual({ sync_claimed_at: null, updated_at: expect.any(String) });
  });
});
