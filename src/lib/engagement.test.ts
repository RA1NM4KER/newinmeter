import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminSupabaseFetch: vi.fn(),
  adminSupabaseFetchAllPages: vi.fn(),
  adminSupabaseRequest: vi.fn(),
  listAllAuthUsers: vi.fn()
}));

vi.mock("./supabase-rest", () => ({
  adminSupabaseFetch: mocks.adminSupabaseFetch,
  adminSupabaseFetchAllPages: mocks.adminSupabaseFetchAllPages,
  adminSupabaseRequest: mocks.adminSupabaseRequest
}));
vi.mock("./user-roles", () => ({ listAllAuthUsers: mocks.listAllAuthUsers }));

import { engagementDateRange, getEngagementMetrics, recordAiFeatureUsage } from "./engagement";

describe("engagement metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAllAuthUsers.mockResolvedValue([
      { userId: "real-a", email: null },
      { userId: "real-b", email: null },
      { userId: "admin", email: null },
      { userId: "demo", email: null },
      { userId: "system-test", email: null }
    ]);
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/user_roles")) {
        return [
          { user_id: "real-a", role: "user", engagement_excluded: false },
          { user_id: "real-b", role: "user", engagement_excluded: false },
          { user_id: "admin", role: "admin", engagement_excluded: false },
          { user_id: "demo", role: "user", engagement_excluded: false },
          { user_id: "system-test", role: "user", engagement_excluded: true }
        ];
      }
      if (path.startsWith("/livemopay_connections")) {
        return [
          { id: "conn-a", user_id: "real-a", status: "connected", is_demo: false, updated_at: "2026-08-26" },
          { id: "conn-b", user_id: "real-b", status: "error", is_demo: false, updated_at: "2026-08-26" },
          { id: "conn-demo", user_id: "demo", status: "connected", is_demo: true, updated_at: "2026-08-26" }
        ];
      }
      throw new Error(`Unexpected fetch: ${path}`);
    });
    mocks.adminSupabaseFetchAllPages.mockImplementation(async (path: string) => {
      if (path.startsWith("/user_activity_days")) {
        return [
          { user_id: "real-a", activity_date: "2026-08-26" },
          { user_id: "real-b", activity_date: "2026-08-20" },
          { user_id: "real-b", activity_date: "2026-07-28" },
          { user_id: "admin", activity_date: "2026-08-26" }
        ];
      }
      if (path.startsWith("/usage_activities")) return [{ connection_id: "conn-a" }, { connection_id: "conn-demo" }];
      if (path.startsWith("/alert_rules")) return [{ connection_id: "conn-b" }];
      if (path.startsWith("/push_subscriptions")) return [{ user_id: "real-b" }, { user_id: "admin" }];
      if (path.startsWith("/user_feature_usage")) return [{ user_id: "real-a" }, { user_id: "system-test" }];
      throw new Error(`Unexpected paged fetch: ${path}`);
    });
  });

  it("uses inclusive SAST calendar windows for DAU, WAU and MAU", () => {
    expect(engagementDateRange(new Date("2026-08-25T22:30:00.000Z"))).toEqual({
      today: "2026-08-26",
      last7DaysStart: "2026-08-20",
      last30DaysStart: "2026-07-28"
    });
  });

  it("derives adoption from domain evidence and excludes admin, demo and flagged accounts", async () => {
    const metrics = await getEngagementMetrics(new Date("2026-08-26T12:00:00.000Z"));

    expect(metrics).toEqual({
      totalRealUsers: 2,
      activeToday: 1,
      activeLast7Days: 2,
      activeLast30Days: 2,
      adoption: {
        activities: { users: 1, percentage: 50 },
        alertsEnabled: { users: 1, percentage: 50 },
        push: { users: 1, percentage: 50 },
        ai: { users: 1, percentage: 50 },
        livemopay: { users: 1, percentage: 50 }
      }
    });
    expect(mocks.adminSupabaseFetchAllPages).toHaveBeenCalledWith(
      "/user_activity_days?select=user_id,activity_date&activity_date=gte.2026-07-28"
    );
  });

  it("records only the aggregate AI feature key through the server-only RPC", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);

    await recordAiFeatureUsage("real-a");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/rpc/record_user_feature_usage",
      { p_user_id: "real-a", p_feature: "ai" },
      "return=minimal"
    );
  });
});
