import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THRESHOLDS } from "@/lib/newinmeter/alert-types";
import { dailyRow, buildTestContext } from "../test-fixtures";
import { getAlertRecommendationsTool } from "./get-alert-recommendations";

const mocks = vi.hoisted(() => ({
  getAlertRulesForUser: vi.fn(),
  getAlertInsights: vi.fn(),
  getLatestBalanceForUser: vi.fn(),
  getSuggestedMonthlyBudget: vi.fn()
}));

vi.mock("@/lib/newinmeter/alerts", () => ({
  DEFAULT_THRESHOLDS,
  getAlertRulesForUser: mocks.getAlertRulesForUser,
  getAlertInsights: mocks.getAlertInsights,
  getLatestBalanceForUser: mocks.getLatestBalanceForUser,
  getSuggestedMonthlyBudget: mocks.getSuggestedMonthlyBudget
}));

function emptyMocks() {
  mocks.getAlertRulesForUser.mockResolvedValue([]);
  mocks.getAlertInsights.mockResolvedValue(null);
  mocks.getLatestBalanceForUser.mockResolvedValue(null);
  mocks.getSuggestedMonthlyBudget.mockResolvedValue(null);
}

describe("get_alert_recommendations", () => {
  it("recommends nothing when there is no supporting data at all (not every alert type by default)", async () => {
    emptyMocks();
    const context = buildTestContext([], [], { from: "", to: "" });

    const result = (await getAlertRecommendationsTool.handler({}, async () => context)) as {
      recommendations: Array<{ type: string }>;
    };

    // usage_anomaly and data_delayed are always-eligible (no data
    // precondition), everything else needs real supporting data.
    expect(result.recommendations.map((r) => r.type).sort()).toEqual(["data_delayed", "usage_anomaly"]);
  });

  it("recommends low_balance with the product default threshold when a balance is known and it isn't already enabled", async () => {
    emptyMocks();
    mocks.getLatestBalanceForUser.mockResolvedValue(120);
    const context = buildTestContext([], [], { from: "", to: "" });

    const result = (await getAlertRecommendationsTool.handler({}, async () => context)) as {
      recommendations: Array<{ type: string; suggestedThreshold: number | null }>;
    };

    const lowBalance = result.recommendations.find((r) => r.type === "low_balance");
    expect(lowBalance?.suggestedThreshold).toBe(DEFAULT_THRESHOLDS.low_balance);
  });

  it("never recommends a type that's already enabled", async () => {
    emptyMocks();
    mocks.getAlertRulesForUser.mockResolvedValue([
      { id: "r1", connectionId: "c1", type: "low_balance", enabled: true, threshold: 200, updatedAt: "" }
    ]);
    mocks.getLatestBalanceForUser.mockResolvedValue(120);
    const context = buildTestContext([], [], { from: "", to: "" });

    const result = (await getAlertRecommendationsTool.handler({}, async () => context)) as {
      recommendations: Array<{ type: string }>;
    };

    expect(result.recommendations.some((r) => r.type === "low_balance")).toBe(false);
  });

  it("recommends monthly_budget with the grounded suggested amount, not an invented number", async () => {
    emptyMocks();
    mocks.getSuggestedMonthlyBudget.mockResolvedValue(1250);
    const context = buildTestContext([], [], { from: "", to: "" });

    const result = (await getAlertRecommendationsTool.handler({}, async () => context)) as {
      recommendations: Array<{ type: string; suggestedThreshold: number | null; reason: string }>;
    };

    const budget = result.recommendations.find((r) => r.type === "monthly_budget");
    expect(budget?.suggestedThreshold).toBe(1250);
    expect(budget?.reason).toContain("1");
  });

  it("recommends daily_spend/daily_kwh only when there is at least some daily history", async () => {
    emptyMocks();
    const emptyContext = buildTestContext([], [], { from: "", to: "" });
    const withHistory = buildTestContext([dailyRow({ periodDate: "2026-08-01" })], [], { from: "", to: "" });

    const withoutHistoryResult = (await getAlertRecommendationsTool.handler({}, async () => emptyContext)) as {
      recommendations: Array<{ type: string }>;
    };
    expect(withoutHistoryResult.recommendations.some((r) => r.type === "daily_spend")).toBe(false);

    const withHistoryResult = (await getAlertRecommendationsTool.handler({}, async () => withHistory)) as {
      recommendations: Array<{ type: string }>;
    };
    expect(withHistoryResult.recommendations.some((r) => r.type === "daily_spend")).toBe(true);
    expect(withHistoryResult.recommendations.some((r) => r.type === "daily_kwh")).toBe(true);
  });

  it("recommends tariff_band_approaching only when a tariff profile is known", async () => {
    emptyMocks();
    mocks.getAlertInsights.mockResolvedValue({
      runway: { estimatedDaysRemaining: null, hasEnoughHistory: false },
      budget: { projectedSpend: null, hasEnoughHistory: false },
      tariff: { currentTariff: null },
      band: { profile: "newinbosch_2026_27", monthKwh: 120, nextBandKwh: 300, warningDistanceKwh: 25 },
      anomaly: { learningDaysSoFar: 5, minLearningDays: 14, hasEnoughHistory: false }
    });
    const context = buildTestContext([], [], { from: "", to: "" });

    const result = (await getAlertRecommendationsTool.handler({}, async () => context)) as {
      recommendations: Array<{ type: string }>;
    };
    expect(result.recommendations.some((r) => r.type === "tariff_band_approaching")).toBe(true);
  });
});
