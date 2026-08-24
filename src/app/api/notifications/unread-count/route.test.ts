import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  getUnreadNotificationCount: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/newinmeter/alerts", () => ({ getUnreadNotificationCount: mocks.getUnreadNotificationCount }));

import { GET } from "./route";

describe("GET /api/notifications/unread-count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
  });

  it("requires authentication", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.getUnreadNotificationCount).not.toHaveBeenCalled();
  });

  it("returns the authenticated user's own unread count", async () => {
    mocks.getUnreadNotificationCount.mockResolvedValue(5);
    const response = await GET();
    expect(mocks.getUnreadNotificationCount).toHaveBeenCalledWith("user-a");
    await expect(response.json()).resolves.toEqual({ count: 5 });
  });

  it("zero clears to zero, not omitted", async () => {
    mocks.getUnreadNotificationCount.mockResolvedValue(0);
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ count: 0 });
  });
});
