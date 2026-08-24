import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  markAllNotificationsRead: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/newinmeter/alerts", () => ({ markAllNotificationsRead: mocks.markAllNotificationsRead }));

import { POST } from "./route";

describe("POST /api/notifications/read-all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
  });

  it("requires authentication", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
    expect(mocks.markAllNotificationsRead).not.toHaveBeenCalled();
  });

  it("marks all read for the authenticated session's own userId and reports the count", async () => {
    mocks.markAllNotificationsRead.mockResolvedValue(4);
    const response = await POST();
    expect(mocks.markAllNotificationsRead).toHaveBeenCalledWith("user-a");
    await expect(response.json()).resolves.toEqual({ ok: true, markedCount: 4 });
  });
});
