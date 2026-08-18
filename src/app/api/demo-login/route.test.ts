import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isValidDemoAccessToken: vi.fn(),
  getNewinmeterDemoEmail: vi.fn(),
  getConnectionForUser: vi.fn(),
  enforceRateLimit: vi.fn(),
  listUsers: vi.fn(),
  generateLink: vi.fn()
}));

vi.mock("@/lib/demo/access-token", () => ({ isValidDemoAccessToken: mocks.isValidDemoAccessToken }));
vi.mock("@/lib/env", () => ({ getNewinmeterDemoEmail: mocks.getNewinmeterDemoEmail }));
vi.mock("@/lib/newinmeter-connection", () => ({ getConnectionForUser: mocks.getConnectionForUser }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (id: string, scope: string) => `${id}:${scope}`,
  rateLimitHeaders: () => ({})
}));
vi.mock("@/lib/supabase/admin-client", () => ({
  createSupabaseAdminClient: () => ({
    auth: { admin: { listUsers: mocks.listUsers, generateLink: mocks.generateLink } }
  })
}));

import { POST } from "./route";

const DEMO_EMAIL = "demo@newinmeter.app";
const demoAuthUser = { id: "demo-user-id", email: DEMO_EMAIL };
const otherAuthUser = { id: "real-user-id", email: "real@example.com" };

function request(body: unknown = { token: "any-token" }) {
  return new Request("http://localhost/api/demo-login", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body)
  });
}

describe("POST /api/demo-login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
    mocks.isValidDemoAccessToken.mockReturnValue(true);
    mocks.getNewinmeterDemoEmail.mockReturnValue(DEMO_EMAIL);
    mocks.listUsers.mockResolvedValue({ data: { users: [demoAuthUser, otherAuthUser] }, error: null });
    mocks.getConnectionForUser.mockResolvedValue({ isDemo: true });
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "hashed-token-abc" } },
      error: null
    });
  });

  it("signs in the configured demo user for a valid token", async () => {
    const response = await POST(request({ token: "correct" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tokenHash: "hashed-token-abc" });
  });

  it("rejects a missing token with the generic message, before touching Supabase", async () => {
    mocks.isValidDemoAccessToken.mockReturnValue(false);
    const response = await POST(request({}));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ message: "Invalid or missing demo access." });
    expect(mocks.listUsers).not.toHaveBeenCalled();
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("rejects an invalid token with the exact same generic message", async () => {
    mocks.isValidDemoAccessToken.mockReturnValue(false);
    const response = await POST(request({ token: "wrong" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ message: "Invalid or missing demo access." });
  });

  it("is rate limited before any token validation or Supabase call", async () => {
    mocks.enforceRateLimit.mockResolvedValue({ allowed: false, minute: {}, day: {} });
    const response = await POST(request({ token: "correct" }));
    expect(response.status).toBe(429);
    expect(mocks.isValidDemoAccessToken).not.toHaveBeenCalled();
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it("never accepts an email/target user from the request body", async () => {
    await POST(
      request({
        token: "correct",
        email: "attacker@example.com",
        userId: "someone-elses-account"
      } as unknown as Record<string, unknown>)
    );
    expect(mocks.generateLink).toHaveBeenCalledWith(expect.objectContaining({ email: DEMO_EMAIL, type: "magiclink" }));
    expect(mocks.generateLink).not.toHaveBeenCalledWith(expect.objectContaining({ email: "attacker@example.com" }));
  });

  it("refuses to sign in if the configured demo email doesn't exist as a Supabase Auth user", async () => {
    mocks.listUsers.mockResolvedValue({ data: { users: [otherAuthUser] }, error: null });
    const response = await POST(request({ token: "correct" }));
    expect(response.status).toBe(401);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("refuses to sign in if the configured demo email's connection is not actually marked is_demo", async () => {
    mocks.getConnectionForUser.mockResolvedValue({ isDemo: false });
    const response = await POST(request({ token: "correct" }));
    expect(response.status).toBe(401);
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it("refuses to sign in when NEWINMETER_DEMO_EMAIL is not configured", async () => {
    mocks.getNewinmeterDemoEmail.mockReturnValue(undefined);
    const response = await POST(request({ token: "correct" }));
    expect(response.status).toBe(401);
    expect(mocks.listUsers).not.toHaveBeenCalled();
  });

  it("returns the generic message when generateLink fails, without leaking the upstream error", async () => {
    mocks.generateLink.mockResolvedValue({ data: null, error: { message: "some internal supabase detail" } });
    const response = await POST(request({ token: "correct" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ message: "Invalid or missing demo access." });
  });

  it("never exposes anything beyond message/tokenHash in the response body", async () => {
    const okResponse = await POST(request({ token: "correct" }));
    const okBody = await okResponse.json();
    expect(Object.keys(okBody).sort()).toEqual(["tokenHash"]);

    mocks.isValidDemoAccessToken.mockReturnValue(false);
    const deniedResponse = await POST(request({ token: "wrong" }));
    const deniedBody = await deniedResponse.json();
    expect(Object.keys(deniedBody).sort()).toEqual(["message"]);
  });
});
