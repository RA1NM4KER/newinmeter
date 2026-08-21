import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActivitiesSession: vi.fn(),
  enforceRateLimit: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireActivitiesSession: mocks.requireActivitiesSession }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (userId: string, scope: string) => `${userId}:${scope}`,
  rateLimitHeaders: () => ({})
}));
vi.mock("@/lib/activity/data", () => ({
  activityValidationErrors: (error: { validationErrors?: Record<string, string> }) => error.validationErrors,
  updateActivity: mocks.updateActivity,
  deleteActivity: mocks.deleteActivity
}));

import { DELETE, PATCH } from "./route";

const session = { userId: "user-a", accessToken: "token", connection: { id: "connection-a" } };

describe("activity item API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActivitiesSession.mockResolvedValue({ ok: true, session });
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
  });

  it("does not expose an activity outside the caller's RLS scope", async () => {
    mocks.updateActivity.mockResolvedValue(null);
    const response = await PATCH(
      new Request("http://localhost/api/activities/other", {
        method: "PATCH",
        body: JSON.stringify({ note: "Changed" })
      }),
      { params: { id: "other" } }
    );
    expect(response.status).toBe(404);
    expect(mocks.updateActivity).toHaveBeenCalledWith("token", "connection-a", "other", { note: "Changed" });
  });

  it("updates an owned activity", async () => {
    mocks.updateActivity.mockResolvedValue({ id: "owned" });
    const response = await PATCH(
      new Request("http://localhost/api/activities/owned", {
        method: "PATCH",
        body: JSON.stringify({ tags: ["heater"], color: "#7c3aed" })
      }),
      { params: { id: "owned" } }
    );
    expect(response.status).toBe(200);
    expect(mocks.updateActivity).toHaveBeenCalledWith("token", "connection-a", "owned", {
      tags: ["heater"],
      color: "#7c3aed"
    });
  });

  it("deletes an owned activity and returns 404 for an inaccessible one", async () => {
    mocks.deleteActivity.mockResolvedValueOnce({ id: "owned" }).mockResolvedValueOnce(null);
    expect((await DELETE(new Request("http://localhost"), { params: { id: "owned" } })).status).toBe(200);
    expect((await DELETE(new Request("http://localhost"), { params: { id: "other" } })).status).toBe(404);
  });

  it("blocks update and delete for the shared demo connection", async () => {
    mocks.requireActivitiesSession.mockResolvedValue({
      ok: true,
      session: { ...session, connection: { id: "connection-a", isDemo: true } }
    });

    const patchResponse = await PATCH(
      new Request("http://localhost/api/activities/owned", { method: "PATCH", body: JSON.stringify({ note: "x" }) }),
      { params: { id: "owned" } }
    );
    expect(patchResponse.status).toBe(403);
    await expect(patchResponse.json()).resolves.toMatchObject({ demoAccount: true });
    expect(mocks.updateActivity).not.toHaveBeenCalled();

    const deleteResponse = await DELETE(new Request("http://localhost"), { params: { id: "owned" } });
    expect(deleteResponse.status).toBe(403);
    await expect(deleteResponse.json()).resolves.toMatchObject({ demoAccount: true });
    expect(mocks.deleteActivity).not.toHaveBeenCalled();
  });
});
