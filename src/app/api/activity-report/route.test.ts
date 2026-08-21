import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActivitiesSession: vi.fn(),
  enforceRateLimit: vi.fn(),
  loadActivityReport: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireActivitiesSession: mocks.requireActivitiesSession }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (userId: string, scope: string) => `${userId}:${scope}`,
  rateLimitHeaders: () => ({})
}));
vi.mock("@/lib/activity/data", () => ({ loadActivityReport: mocks.loadActivityReport }));

import { GET } from "./route";

describe("activity report API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActivitiesSession.mockResolvedValue({ ok: true, session: { userId: "user-a", accessToken: "token" } });
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
    mocks.loadActivityReport.mockResolvedValue({ rows: [], summary: {} });
  });

  it("passes normalized tags and utility filters to the set-based report query", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/activity-report?from=2026-08-01&to=2026-08-04&tag=Geyser&tags=heater,geyser&utility=water"
      )
    );
    expect(response.status).toBe(200);
    expect(mocks.loadActivityReport).toHaveBeenCalledWith("token", {
      from: "2026-08-01",
      to: "2026-08-04",
      tags: ["geyser", "heater"],
      utility: "water"
    });
  });

  it("rejects missing or reversed ranges", async () => {
    expect((await GET(new Request("http://localhost/api/activity-report"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/activity-report?from=2026-08-04&to=2026-08-01"))).status).toBe(
      400
    );
  });
});
