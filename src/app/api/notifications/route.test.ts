import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  getRecentNotifications: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/newinmeter/alerts", () => ({ getRecentNotifications: mocks.getRecentNotifications }));

import { GET } from "./route";

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
  });

  it("requires authentication", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.getRecentNotifications).not.toHaveBeenCalled();
  });

  it("returns the authenticated user's own notifications", async () => {
    mocks.getRecentNotifications.mockResolvedValue([{ id: "n1" }]);
    const response = await GET();
    expect(mocks.getRecentNotifications).toHaveBeenCalledWith("user-a");
    await expect(response.json()).resolves.toEqual({ notifications: [{ id: "n1" }] });
  });
});
