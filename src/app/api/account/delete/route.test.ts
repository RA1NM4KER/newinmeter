import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  deleteAccountForUser: vi.fn(),
  signOut: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/newinmeter/connection", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/connection")>("@/lib/newinmeter/connection");
  return {
    DemoAccountProtectedError: actual.DemoAccountProtectedError,
    deleteAccountForUser: mocks.deleteAccountForUser
  };
});
vi.mock("@/lib/supabase/server-client", () => ({
  createServerSupabaseClient: () => ({ auth: { signOut: mocks.signOut } })
}));

import { DemoAccountProtectedError } from "@/lib/newinmeter/connection";
import { POST } from "./route";

describe("POST /api/account/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("deletes a real account and signs out", async () => {
    mocks.deleteAccountForUser.mockResolvedValue(undefined);
    const response = await POST();
    expect(response.status).toBe(200);
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it("refuses to delete the shared demo account", async () => {
    mocks.deleteAccountForUser.mockRejectedValue(new DemoAccountProtectedError("account deletion"));
    const response = await POST();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ demoAccount: true });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
