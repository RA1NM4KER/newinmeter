import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  markNotificationRead: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/newinmeter/alerts", () => ({ markNotificationRead: mocks.markNotificationRead }));

import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/notifications/event-1/read", { method: "POST" });
}

describe("POST /api/notifications/[id]/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
    mocks.markNotificationRead.mockResolvedValue(undefined);
  });

  it("requires authentication", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    const response = await POST(request(), { params: { id: "event-1" } });
    expect(response.status).toBe(401);
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
  });

  it("marks the event read, scoped to the authenticated session's own userId", async () => {
    const response = await POST(request(), { params: { id: "event-1" } });
    expect(mocks.markNotificationRead).toHaveBeenCalledWith("user-a", "event-1");
    expect(response.status).toBe(200);
  });
});
