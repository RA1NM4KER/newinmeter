import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  enforceRateLimit: vi.fn(),
  getConnectionForUser: vi.fn(),
  beginLivemopayConnection: vi.fn(),
  loginWithLiveMopayCredentials: vi.fn(),
  discoverLiveMopayAccounts: vi.fn(),
  recordFunnelEvent: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/funnel", () => ({ recordFunnelEvent: mocks.recordFunnelEvent }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (userId: string, scope: string) => `${userId}:${scope}`,
  rateLimitHeaders: () => ({})
}));
vi.mock("@/lib/newinmeter/web", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/web")>("@/lib/newinmeter/web");
  return {
    LiveMopayInvalidCredentialsError: actual.LiveMopayInvalidCredentialsError,
    LiveMopayTooManyAttemptsError: actual.LiveMopayTooManyAttemptsError,
    loginWithLiveMopayCredentials: mocks.loginWithLiveMopayCredentials,
    discoverLiveMopayAccounts: mocks.discoverLiveMopayAccounts
  };
});
// See the identical stub in src/lib/newinmeter/connection.test.ts: this file
// imports the real connection.ts module (for its named error export), whose
// getConnectionForUser uses React 19's cache(), unavailable in the installed
// react@18.3.1 outside Next's own bundler.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("@/lib/newinmeter/connection", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/connection")>("@/lib/newinmeter/connection");
  return {
    DemoAccountProtectedError: actual.DemoAccountProtectedError,
    beginLivemopayConnection: mocks.beginLivemopayConnection,
    getConnectionForUser: mocks.getConnectionForUser
  };
});

import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/livemopay/connect", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/livemopay/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@example.com", accessToken: "t" });
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
  });

  it("refuses to attach real credentials to the shared demo account", async () => {
    mocks.getConnectionForUser.mockResolvedValue({ status: "connected", isDemo: true });

    const response = await POST(request({ email: "real@example.com", password: "secret123" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ demoAccount: true });
    expect(mocks.loginWithLiveMopayCredentials).not.toHaveBeenCalled();
  });

  it("connects a real, non-demo account normally", async () => {
    mocks.getConnectionForUser.mockResolvedValue(null);
    mocks.loginWithLiveMopayCredentials.mockResolvedValue({ idToken: "id", refreshToken: "r", localId: "l" });
    mocks.discoverLiveMopayAccounts.mockResolvedValue([
      { accountId: "a", companyId: "b", propertyId: "c", label: "Home" }
    ]);
    mocks.beginLivemopayConnection.mockResolvedValue({ status: "connected", accountLabel: "Home" });

    const response = await POST(request({ email: "real@example.com", password: "secret123" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "connected", accountLabel: "Home" });
    expect(mocks.recordFunnelEvent).toHaveBeenCalledWith("connect_attempted");
    expect(mocks.recordFunnelEvent).toHaveBeenCalledWith("connect_succeeded");
  });

  it("returns actionable copy for wrong LiveMopay credentials and records the funnel event", async () => {
    const { LiveMopayInvalidCredentialsError } = await import("@/lib/newinmeter/web");
    mocks.getConnectionForUser.mockResolvedValue(null);
    mocks.loginWithLiveMopayCredentials.mockRejectedValue(new LiveMopayInvalidCredentialsError());

    const response = await POST(request({ email: "real@example.com", password: "wrong" }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ invalidCredentials: true });
    expect(mocks.recordFunnelEvent).toHaveBeenCalledWith("connect_invalid_credentials");
  });

  it("returns a distinct message when LiveMopay itself is throttling attempts", async () => {
    const { LiveMopayTooManyAttemptsError } = await import("@/lib/newinmeter/web");
    mocks.getConnectionForUser.mockResolvedValue(null);
    mocks.loginWithLiveMopayCredentials.mockRejectedValue(new LiveMopayTooManyAttemptsError());

    const response = await POST(request({ email: "real@example.com", password: "x" }));

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.invalidCredentials).toBeUndefined();
  });

  it("never logs or exposes the submitted password", async () => {
    mocks.getConnectionForUser.mockResolvedValue(null);
    mocks.loginWithLiveMopayCredentials.mockRejectedValue(new Error("network failure"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await POST(request({ email: "real@example.com", password: "hunter2-secret" }));

    const loggedText = consoleSpy.mock.calls.flat().join(" ");
    expect(loggedText).not.toContain("hunter2-secret");
    consoleSpy.mockRestore();
  });
});
