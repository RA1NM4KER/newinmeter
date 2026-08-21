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
vi.mock("../supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { deleteUser: mocks.deleteUser } } })
}));
vi.mock("../token-encryption", () => ({
  encryptRefreshToken: () => ({ ciphertext: "c", iv: "i", authTag: "t" }),
  decryptRefreshToken: () => "plain-refresh-token"
}));

import {
  beginLivemopayConnection,
  DemoAccountProtectedError,
  deleteAccountForUser,
  disconnectLivemopayConnection,
  listConnectionsForStaleCheck
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
