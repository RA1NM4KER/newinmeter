// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminSupabaseFetch: vi.fn(),
  adminSupabaseRequest: vi.fn()
}));

vi.mock("./supabase-rest", () => ({
  adminSupabaseFetch: mocks.adminSupabaseFetch,
  adminSupabaseRequest: mocks.adminSupabaseRequest
}));
// React's cache() requires a request context this test has none of --
// same shim as alerts.test.ts/connection.test.ts.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});

import {
  getFeatureAccessForUsers,
  getFeatureRolloutSummaries,
  getRolloutModes,
  getUserFeatureAccessDetailed,
  hasFeatureAccess,
  listFeatureOverrides,
  setRolloutMode,
  setUserFeatureOverride
} from "./features";

function mockRollouts(modes: Partial<Record<string, string>>) {
  return Object.entries(modes).map(([feature_key, rollout_mode]) => ({ feature_key, rollout_mode }));
}

describe("getRolloutModes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults any feature missing from the table to 'off'", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue(mockRollouts({ ai: "everyone" }));
    const modes = await getRolloutModes();
    expect(modes).toEqual({ ai: "everyone", activities: "off", live: "off", alerts: "off" });
  });
});

describe("hasFeatureAccess -- resolution rule", () => {
  beforeEach(() => vi.clearAllMocks());

  function setup(mode: string, override?: boolean) {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("/feature_rollouts")) return mockRollouts({ alerts: mode });
      if (path.includes("/feature_overrides")) return override === undefined ? [] : [{ enabled: override }];
      throw new Error(`unexpected path: ${path}`);
    });
  }

  it("off beats everything, even an explicit true override", async () => {
    setup("off", true);
    expect(await hasFeatureAccess("user-1", "alerts")).toBe(false);
  });

  it("an explicit override wins over the rollout default", async () => {
    setup("everyone", false);
    expect(await hasFeatureAccess("user-1", "alerts")).toBe(false);

    setup("selected", true);
    expect(await hasFeatureAccess("user-1", "alerts")).toBe(true);
  });

  it("falls back to the rollout default with no override", async () => {
    setup("everyone");
    expect(await hasFeatureAccess("user-1", "alerts")).toBe(true);

    setup("selected");
    expect(await hasFeatureAccess("user-1", "alerts")).toBe(false);
  });

  it("preserves an override's effect through an Off round-trip -- off masks it, but doesn't erase it", async () => {
    // Same override (enabled: true) present throughout; only the rollout
    // mode changes. This is the exact "preserve overrides through Off"
    // invariant: nothing needs to re-write the override when the feature
    // comes back.
    setup("everyone", true);
    expect(await hasFeatureAccess("user-1", "alerts")).toBe(true);

    setup("off", true);
    expect(await hasFeatureAccess("user-1", "alerts")).toBe(false);

    setup("everyone", true);
    expect(await hasFeatureAccess("user-1", "alerts")).toBe(true);
  });
});

describe("getUserFeatureAccessDetailed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports source 'override' only for features with an explicit row", async () => {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("/feature_rollouts")) {
        return mockRollouts({ ai: "everyone", activities: "selected", live: "selected", alerts: "everyone" });
      }
      if (path.includes("/feature_overrides")) {
        return [{ feature_key: "activities", enabled: true }];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const detail = await getUserFeatureAccessDetailed("user-1");

    expect(detail.ai).toEqual({ enabled: true, source: "rollout" });
    expect(detail.activities).toEqual({ enabled: true, source: "override" });
    expect(detail.live).toEqual({ enabled: false, source: "rollout" });
    expect(detail.alerts).toEqual({ enabled: true, source: "rollout" });
  });
});

describe("getFeatureAccessForUsers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns an empty map without any fetch for an empty user list", async () => {
    const result = await getFeatureAccessForUsers([]);
    expect(result.size).toBe(0);
    expect(mocks.adminSupabaseFetch).not.toHaveBeenCalled();
  });

  it("resolves every requested user in one rollout fetch + one overrides fetch", async () => {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("/feature_rollouts")) return mockRollouts({ alerts: "selected" });
      if (path.includes("/feature_overrides")) {
        return [{ user_id: "user-a", feature_key: "alerts", enabled: true }];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await getFeatureAccessForUsers(["user-a", "user-b"]);

    expect(result.get("user-a")?.alerts).toEqual({ enabled: true, source: "override" });
    expect(result.get("user-b")?.alerts).toEqual({ enabled: false, source: "rollout" });
    expect(mocks.adminSupabaseFetch).toHaveBeenCalledTimes(2);
  });
});

describe("getFeatureRolloutSummaries -- effective counts, not raw override rows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("counts EFFECTIVE access: everyone-minus-revokes, selected-only-grants", async () => {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("/feature_rollouts")) return mockRollouts({ ai: "everyone", activities: "selected" });
      if (path.includes("/feature_overrides")) {
        return [
          { user_id: "user-a", feature_key: "ai", enabled: false }, // revoked from "everyone"
          { user_id: "user-b", feature_key: "activities", enabled: true } // granted under "selected"
        ];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const summaries = await getFeatureRolloutSummaries(["user-a", "user-b", "user-c"]);
    const ai = summaries.find((s) => s.key === "ai")!;
    const activities = summaries.find((s) => s.key === "activities")!;

    expect(ai).toMatchObject({ mode: "everyone", enabledCount: 2, totalCount: 3 }); // b, c (a revoked)
    expect(activities).toMatchObject({ mode: "selected", enabledCount: 1, totalCount: 3 }); // only b granted
  });
});

describe("admin writes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("setRolloutMode PATCHes the feature's row by key", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);
    await setRolloutMode("alerts", "off");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      "/feature_rollouts?feature_key=eq.alerts",
      expect.objectContaining({ rollout_mode: "off" }),
      "return=minimal"
    );
  });

  it("setUserFeatureOverride always writes an explicit override row, regardless of rollout mode -- no rollout read first", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);
    await setUserFeatureOverride("user-1", "alerts", false);

    expect(mocks.adminSupabaseFetch).not.toHaveBeenCalled();
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/feature_overrides?on_conflict=user_id,feature_key",
      [expect.objectContaining({ user_id: "user-1", feature_key: "alerts", enabled: false })],
      "resolution=merge-duplicates,return=minimal"
    );
  });

  it("listFeatureOverrides returns every override row for a feature, both grants and revokes", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([
      { user_id: "user-a", enabled: true },
      { user_id: "user-b", enabled: false }
    ]);
    const overrides = await listFeatureOverrides("alerts");
    expect(overrides).toEqual([
      { userId: "user-a", enabled: true },
      { userId: "user-b", enabled: false }
    ]);
  });
});
