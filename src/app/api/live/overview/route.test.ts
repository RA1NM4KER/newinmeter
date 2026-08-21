import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSession: vi.fn(),
  getOrCreateUserPermissions: vi.fn(),
  enforceRateLimit: vi.fn(),
  loadLiveOverview: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ getAuthenticatedSession: mocks.getAuthenticatedSession }));
vi.mock("@/lib/user-roles", () => ({ getOrCreateUserPermissions: mocks.getOrCreateUserPermissions }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (userId: string, scope: string) => `${userId}:${scope}`,
  rateLimitHeaders: () => ({})
}));
vi.mock("@/lib/live/meter", () => ({ loadLiveOverview: mocks.loadLiveOverview }));

import { GET } from "./route";

const emptyOverview = {
  device: null,
  window: "30m",
  latest: { estimatedWatts: null, estimateState: "waiting", lastPulseAt: null, lastDeltaMs: null },
  energy: { last5MinutesKwh: 0, lastHourKwh: 0 },
  series: [],
  generatedAt: "2026-08-07T10:00:00.000Z"
};

function get(url: string) {
  return GET(new Request(url));
}

describe("GET /api/live/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedSession.mockResolvedValue({ userId: "user-a", email: "a@x.com", accessToken: "t" });
    mocks.getOrCreateUserPermissions.mockResolvedValue({ liveMeterEnabled: true });
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
    mocks.loadLiveOverview.mockResolvedValue(emptyOverview);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.getAuthenticatedSession.mockResolvedValue(null);
    const response = await get("http://localhost/api/live/overview?window=30m");
    expect(response.status).toBe(401);
    expect(mocks.loadLiveOverview).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) for a feature-disabled user, exposing no live data", async () => {
    mocks.getOrCreateUserPermissions.mockResolvedValue({ liveMeterEnabled: false });
    const response = await get("http://localhost/api/live/overview?window=30m");
    expect(response.status).toBe(404);
    expect(mocks.loadLiveOverview).not.toHaveBeenCalled();
  });

  it("rejects an invalid window with 400", async () => {
    const response = await get("http://localhost/api/live/overview?window=2h");
    expect(response.status).toBe(400);
    expect(mocks.loadLiveOverview).not.toHaveBeenCalled();
  });

  it("defaults the window when none is given", async () => {
    const response = await get("http://localhost/api/live/overview");
    expect(response.status).toBe(200);
    expect(mocks.loadLiveOverview).toHaveBeenCalledWith("user-a", "30m");
  });

  it("resolves data for the session user only -- ignoring any client-supplied ids", async () => {
    const response = await get(
      "http://localhost/api/live/overview?window=1h&userId=user-EVIL&device_id=dev-EVIL&connection_id=conn-EVIL"
    );
    expect(response.status).toBe(200);
    // Only the authenticated user id and validated window are ever passed on.
    expect(mocks.loadLiveOverview).toHaveBeenCalledWith("user-a", "1h");
  });

  it("returns the typed empty overview when the user has no device", async () => {
    const response = await get("http://localhost/api/live/overview?window=30m");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ device: null, series: [] });
  });

  it("returns 429 when rate limited", async () => {
    mocks.enforceRateLimit.mockResolvedValue({ allowed: false, minute: {}, day: {} });
    const response = await get("http://localhost/api/live/overview?window=30m");
    expect(response.status).toBe(429);
    expect(mocks.loadLiveOverview).not.toHaveBeenCalled();
  });
});
