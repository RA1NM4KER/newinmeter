import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  disconnectLivemopayConnection: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/newinmeter/connection", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/connection")>("@/lib/newinmeter/connection");
  return {
    DemoAccountProtectedError: actual.DemoAccountProtectedError,
    disconnectLivemopayConnection: mocks.disconnectLivemopayConnection
  };
});

import { DemoAccountProtectedError } from "@/lib/newinmeter/connection";
import { POST } from "./route";

describe("POST /api/livemopay/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
  });

  it("disconnects a real connection", async () => {
    mocks.disconnectLivemopayConnection.mockResolvedValue(undefined);
    const response = await POST();
    expect(response.status).toBe(200);
  });

  it("returns 403 with a machine-readable flag for a demo connection", async () => {
    mocks.disconnectLivemopayConnection.mockRejectedValue(new DemoAccountProtectedError("disconnecting"));
    const response = await POST();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ demoAccount: true });
  });
});
