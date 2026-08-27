import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireActivitiesSession: vi.fn(),
  enforceRateLimit: vi.fn(),
  loadActivities: vi.fn(),
  loadActivityTags: vi.fn(),
  createActivity: vi.fn(),
  resolveOverlappingUsageAnomalyEvents: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireActivitiesSession: mocks.requireActivitiesSession }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (userId: string, scope: string) => `${userId}:${scope}`,
  rateLimitHeaders: () => ({})
}));
vi.mock("@/lib/activity/data", () => ({
  activityValidationErrors: (error: { validationErrors?: Record<string, string> }) => error.validationErrors,
  createActivity: mocks.createActivity,
  loadActivities: mocks.loadActivities,
  loadActivityTags: mocks.loadActivityTags
}));
// Real alerts.ts pulls in connection.ts's React 19 cache() (unsupported by
// this test's react@18.3.1 outside Next's own bundler, same reason
// alerts.test.ts shims it) -- mocked here since this route only needs the
// one best-effort resolve function, not the real alert-evaluation stack.
vi.mock("@/lib/newinmeter/alerts", () => ({
  resolveOverlappingUsageAnomalyEvents: mocks.resolveOverlappingUsageAnomalyEvents
}));

import { GET, POST } from "./route";

const session = { userId: "user-a", accessToken: "token", connection: { id: "connection-a" } };

describe("activities API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActivitiesSession.mockResolvedValue({ ok: true, session });
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
    mocks.loadActivities.mockResolvedValue([]);
    mocks.loadActivityTags.mockResolvedValue({ tags: [], colors: {} });
    mocks.resolveOverlappingUsageAnomalyEvents.mockResolvedValue(undefined);
  });

  it("rejects unauthenticated access", async () => {
    mocks.requireActivitiesSession.mockResolvedValue({ ok: false, status: 401 });
    const response = await GET(new Request("http://localhost/api/activities"));
    expect(response.status).toBe(401);
  });

  it("normalizes report filters before loading connection-scoped activities", async () => {
    await GET(new Request("http://localhost/api/activities?from=2026-08-01&to=2026-08-04&tag=Geyser&tag=geyser"));
    expect(mocks.loadActivities).toHaveBeenCalledWith(
      "token",
      expect.objectContaining({
        from: "2026-08-01",
        to: "2026-08-04",
        tags: ["geyser"]
      })
    );
  });

  it("returns recent colours alongside tag suggestions", async () => {
    mocks.loadActivityTags.mockResolvedValue({ tags: ["geyser"], colors: { geyser: "#2563eb" } });
    const response = await GET(new Request("http://localhost/api/activities?mode=tags"));
    await expect(response.json()).resolves.toEqual({ tags: ["geyser"], colors: { geyser: "#2563eb" } });
  });

  it("resolves connection ownership server-side and ignores a browser connection id", async () => {
    mocks.createActivity.mockResolvedValue({
      id: "activity-a",
      startsAt: "2026-08-04T18:00:00",
      endsAt: "2026-08-04T20:00:00"
    });
    const response = await POST(
      new Request("http://localhost/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: "connection-b",
          date: "2026-08-04",
          allDay: true,
          tags: ["Guests"],
          color: "#2563eb"
        })
      })
    );
    expect(response.status).toBe(201);
    expect(mocks.createActivity).toHaveBeenCalledWith(
      "token",
      "connection-a",
      expect.objectContaining({ tags: ["Guests"], color: "#2563eb" })
    );
    // Best-effort usage_anomaly resolution runs after every create, scoped
    // to the server-resolved connection (never the browser-supplied one).
    expect(mocks.resolveOverlappingUsageAnomalyEvents).toHaveBeenCalledWith(
      "connection-a",
      "2026-08-04T18:00:00",
      "2026-08-04T20:00:00"
    );
  });

  it("still returns 201 when resolving usage_anomaly overlap fails -- never fails activity creation", async () => {
    mocks.createActivity.mockResolvedValue({
      id: "activity-a",
      startsAt: "2026-08-04T18:00:00",
      endsAt: "2026-08-04T20:00:00"
    });
    mocks.resolveOverlappingUsageAnomalyEvents.mockRejectedValue(new Error("boom"));
    const response = await POST(
      new Request("http://localhost/api/activities", {
        method: "POST",
        body: JSON.stringify({ date: "2026-08-04", allDay: true, tags: ["Guests"] })
      })
    );
    expect(response.status).toBe(201);
  });

  it("allows demo-local activity creation so the walkthrough stays interactive", async () => {
    mocks.requireActivitiesSession.mockResolvedValue({
      ok: true,
      session: { ...session, connection: { id: "connection-a", isDemo: true } }
    });
    mocks.createActivity.mockResolvedValue({
      id: "demo-activity",
      startsAt: "2026-08-04T00:00:00",
      endsAt: "2026-08-05T00:00:00"
    });
    const response = await POST(
      new Request("http://localhost/api/activities", {
        method: "POST",
        body: JSON.stringify({ date: "2026-08-04", allDay: true, tags: ["Guests"] })
      })
    );
    expect(response.status).toBe(201);
    expect(mocks.createActivity).toHaveBeenCalledWith("token", "connection-a", expect.any(Object));
  });

  it("returns field validation failures as 400", async () => {
    mocks.createActivity.mockRejectedValue(
      Object.assign(new Error("Invalid"), { validationErrors: { tags: "Add at least one tag." } })
    );
    const response = await POST(
      new Request("http://localhost/api/activities", {
        method: "POST",
        body: JSON.stringify({ date: "2026-08-04", allDay: true, tags: [] })
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ errors: { tags: "Add at least one tag." } });
  });
});
