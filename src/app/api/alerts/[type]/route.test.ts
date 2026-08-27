import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  upsertAlertRule: vi.fn(),
  hasFeatureAccess: vi.fn(),
  getConnectionForUser: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/features", () => ({ hasFeatureAccess: mocks.hasFeatureAccess }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("@/lib/newinmeter/connection", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/connection")>("@/lib/newinmeter/connection");
  return {
    DemoAccountProtectedError: actual.DemoAccountProtectedError,
    getConnectionForUser: mocks.getConnectionForUser
  };
});
vi.mock("@/lib/newinmeter/alerts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/alerts")>("@/lib/newinmeter/alerts");
  return { ...actual, upsertAlertRule: mocks.upsertAlertRule };
});

import { AlertRuleValidationError, AutoSyncRequiredError } from "@/lib/newinmeter/alerts";
import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/alerts/low_balance", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/alerts/[type]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
    mocks.hasFeatureAccess.mockResolvedValue(true);
    mocks.getConnectionForUser.mockResolvedValue({ isDemo: false });
  });

  it("returns 403 when the user's Alerts access is off", async () => {
    mocks.hasFeatureAccess.mockResolvedValue(false);
    const response = await POST(request({ enabled: true, threshold: 200 }), { params: { type: "low_balance" } });
    expect(response.status).toBe(403);
    expect(mocks.upsertAlertRule).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    const response = await POST(request({ enabled: true, threshold: 200 }), { params: { type: "low_balance" } });
    expect(response.status).toBe(401);
    expect(mocks.upsertAlertRule).not.toHaveBeenCalled();
  });

  it("rejects an unknown alert type before touching the database", async () => {
    const response = await POST(request({ enabled: true, threshold: 200 }), { params: { type: "not_a_real_type" } });
    expect(response.status).toBe(404);
    expect(mocks.upsertAlertRule).not.toHaveBeenCalled();
  });

  it("scopes the write to the authenticated session's own connection -- there is no field to target another user's", async () => {
    mocks.upsertAlertRule.mockResolvedValue({
      rule: { id: "r1", connectionId: "conn-a", type: "low_balance", enabled: true, threshold: 200, updatedAt: "now" },
      autoSyncEnabled: true
    });

    await POST(
      request({ enabled: true, threshold: 200, connectionId: "someone-elses-connection" }),
      { params: { type: "low_balance" } }
    );

    expect(mocks.upsertAlertRule).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-a", type: "low_balance", enabled: true, threshold: 200 })
    );
  });

  it("returns 409 with autoSyncRequired when the rule needs confirmation", async () => {
    mocks.upsertAlertRule.mockRejectedValue(new AutoSyncRequiredError());
    const response = await POST(request({ enabled: true, threshold: 50 }), { params: { type: "daily_spend" } });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ autoSyncRequired: true });
  });

  it("returns 400 for an invalid threshold", async () => {
    mocks.upsertAlertRule.mockRejectedValue(new AlertRuleValidationError("Must be greater than 0."));
    const response = await POST(request({ enabled: true, threshold: -5 }), { params: { type: "daily_spend" } });
    expect(response.status).toBe(400);
  });

  it("returns 403 for a demo connection", async () => {
    mocks.getConnectionForUser.mockResolvedValue({ isDemo: true });
    const response = await POST(request({ enabled: true, threshold: 200 }), { params: { type: "low_balance" } });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ demoAccount: true });
    expect(mocks.upsertAlertRule).not.toHaveBeenCalled();
  });
});
