import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  setRolloutMode: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock("@/lib/features", () => ({ setRolloutMode: mocks.setRolloutMode }));

import { PATCH } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/admin/features/alerts", { method: "PATCH", body: JSON.stringify(body) });
}

describe("PATCH /api/admin/features/[featureKey]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: false, status: 401 });
    const response = await PATCH(request({ rolloutMode: "off" }), { params: { featureKey: "alerts" } });
    expect(response.status).toBe(401);
    expect(mocks.setRolloutMode).not.toHaveBeenCalled();
  });

  it("requires admin -- a signed-in non-admin gets 403, not the mutation", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: false, status: 403 });
    const response = await PATCH(request({ rolloutMode: "off" }), { params: { featureKey: "alerts" } });
    expect(response.status).toBe(403);
    expect(mocks.setRolloutMode).not.toHaveBeenCalled();
  });

  it("404s for an unknown feature key, never reaching the write", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin-1" } });
    const response = await PATCH(request({ rolloutMode: "off" }), { params: { featureKey: "not_a_feature" } });
    expect(response.status).toBe(404);
    expect(mocks.setRolloutMode).not.toHaveBeenCalled();
  });

  it("rejects an invalid rollout mode", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin-1" } });
    await expect(
      PATCH(request({ rolloutMode: "everybody" }), { params: { featureKey: "alerts" } })
    ).rejects.toThrow();
    expect(mocks.setRolloutMode).not.toHaveBeenCalled();
  });

  it("applies a valid mode change for an admin", async () => {
    mocks.requireAdminSession.mockResolvedValue({ ok: true, session: { userId: "admin-1" } });
    mocks.setRolloutMode.mockResolvedValue(undefined);

    const response = await PATCH(request({ rolloutMode: "off" }), { params: { featureKey: "alerts" } });

    expect(response.status).toBe(200);
    expect(mocks.setRolloutMode).toHaveBeenCalledWith("alerts", "off");
  });
});
