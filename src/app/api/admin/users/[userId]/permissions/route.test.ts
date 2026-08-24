import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  setUserFeatureOverride: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock("@/lib/features", () => ({ setUserFeatureOverride: mocks.setUserFeatureOverride }));

import { PATCH } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/users/user-1/permissions", {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

describe("PATCH /api/admin/users/[userId]/permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: false, status: 401 });
    const response = await PATCH(request({ alerts: false }), { params: { userId: "user-1" } });
    expect(response.status).toBe(401);
    expect(mocks.setUserFeatureOverride).not.toHaveBeenCalled();
  });

  it("requires admin -- a signed-in non-admin gets 403, not the mutation", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: false, status: 403 });
    const response = await PATCH(request({ alerts: false }), { params: { userId: "user-1" } });
    expect(response.status).toBe(403);
    expect(mocks.setUserFeatureOverride).not.toHaveBeenCalled();
  });

  it("rejects a body with no recognized feature key", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin-1" } });
    await expect(PATCH(request({}), { params: { userId: "user-1" } })).rejects.toThrow();
    expect(mocks.setUserFeatureOverride).not.toHaveBeenCalled();
  });

  it("writes an override for each provided feature key, in one call per key", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin-1" } });
    mocks.setUserFeatureOverride.mockResolvedValue(undefined);

    const response = await PATCH(request({ alerts: false, live: true }), { params: { userId: "user-1" } });

    expect(response.status).toBe(200);
    expect(mocks.setUserFeatureOverride).toHaveBeenCalledWith("user-1", "alerts", false);
    expect(mocks.setUserFeatureOverride).toHaveBeenCalledWith("user-1", "live", true);
    expect(mocks.setUserFeatureOverride).toHaveBeenCalledTimes(2);
  });

  it("leaves features not present in the body untouched", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin-1" } });
    mocks.setUserFeatureOverride.mockResolvedValue(undefined);

    await PATCH(request({ ai: true }), { params: { userId: "user-1" } });

    expect(mocks.setUserFeatureOverride).toHaveBeenCalledTimes(1);
    expect(mocks.setUserFeatureOverride).toHaveBeenCalledWith("user-1", "ai", true);
  });
});
