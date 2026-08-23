import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  setAutoSyncEnabled: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("@/lib/newinmeter/connection", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/connection")>("@/lib/newinmeter/connection");
  return {
    DemoAccountProtectedError: actual.DemoAccountProtectedError,
    setAutoSyncEnabled: mocks.setAutoSyncEnabled
  };
});

import { DemoAccountProtectedError } from "@/lib/newinmeter/connection";
import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/livemopay/auto-sync", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/livemopay/auto-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
  });

  it("requires authentication", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    const response = await POST(request({ enabled: true }));
    expect(response.status).toBe(401);
    expect(mocks.setAutoSyncEnabled).not.toHaveBeenCalled();
  });

  it("scopes the change to the authenticated session's own connection, never a browser-supplied id", async () => {
    mocks.setAutoSyncEnabled.mockResolvedValue({ autoSyncEnabled: true, nextSyncAt: "2026-01-01T00:00:00.000Z" });
    // Even if the request body tried to smuggle a connection id, the route
    // never reads one -- only { enabled } is parsed, and setAutoSyncEnabled
    // is always called with the session's userId.
    await POST(request({ enabled: true, connectionId: "someone-elses-connection" }));
    expect(mocks.setAutoSyncEnabled).toHaveBeenCalledWith("user-a", true);
  });

  it("returns 403 for a demo connection", async () => {
    mocks.setAutoSyncEnabled.mockRejectedValue(new DemoAccountProtectedError("automatic sync"));
    const response = await POST(request({ enabled: true }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ demoAccount: true });
  });

  it("rejects a malformed body", async () => {
    const response = await POST(request({ enabled: "yes" }));
    expect(response.status).toBe(400);
    expect(mocks.setAutoSyncEnabled).not.toHaveBeenCalled();
  });
});
