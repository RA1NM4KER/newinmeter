import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  getRecentNotifications: vi.fn(),
  hasAnyEnabledAlertRule: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/newinmeter/alerts", () => ({
  getRecentNotifications: mocks.getRecentNotifications,
  hasAnyEnabledAlertRule: mocks.hasAnyEnabledAlertRule
}));

import { GET } from "./route";

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
    mocks.hasAnyEnabledAlertRule.mockResolvedValue(true);
  });

  it("requires authentication", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.getRecentNotifications).not.toHaveBeenCalled();
    expect(mocks.hasAnyEnabledAlertRule).not.toHaveBeenCalled();
  });

  it("returns the authenticated user's own notifications and enabled-alerts flag", async () => {
    mocks.getRecentNotifications.mockResolvedValue([{ id: "n1" }]);
    mocks.hasAnyEnabledAlertRule.mockResolvedValue(true);
    const response = await GET();
    expect(mocks.getRecentNotifications).toHaveBeenCalledWith("user-a");
    expect(mocks.hasAnyEnabledAlertRule).toHaveBeenCalledWith("user-a");
    await expect(response.json()).resolves.toEqual({ notifications: [{ id: "n1" }], hasEnabledAlerts: true });
  });

  it("reports hasEnabledAlerts: false when nothing is enabled, even with historical notifications", async () => {
    mocks.getRecentNotifications.mockResolvedValue([{ id: "n1" }]);
    mocks.hasAnyEnabledAlertRule.mockResolvedValue(false);
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ notifications: [{ id: "n1" }], hasEnabledAlerts: false });
  });
});
