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

  it("recommends daily_spend/daily_kwh only once there are enough COMPLETE days for a grounded percentile threshold, never a flat default", async () => {
    emptyMocks();
    const emptyContext = buildTestContext([], [], { from: "", to: "" });
    // 6 complete days -- one short of the 7-day minimum -- must NOT trigger
    // a recommendation (below the grounding floor, not just "some" history).
    const almostEnoughHistory = buildTestContext(
      Array.from({ length: 6 }, (_, i) =>
        dailyRow({ periodDate: `2026-08-0${i + 1}`, totalSpend: 50 + i, energyKwh: 10 + i, isComplete: true })
      ),
      [],
      { from: "", to: "" }
    );
    // 10 complete days, with an incomplete "today" row that must be
    // excluded from the stats entirely.
    const withHistory = buildTestContext(
      [
        ...Array.from({ length: 10 }, (_, i) =>
          dailyRow({ periodDate: `2026-08-${String(i + 1).padStart(2, "0")}`, totalSpend: 50 + i, energyKwh: 10 + i, isComplete: true })
        ),
        dailyRow({ periodDate: "2026-08-20", totalSpend: 9999, energyKwh: 9999, isComplete: false })
      ],
      [],
      { from: "", to: "" }
    );

    const withoutHistoryResult = (await getAlertRecommendationsTool.handler({}, async () => emptyContext)) as {
      recommendations: Array<{ type: string }>;
    };
    expect(withoutHistoryResult.recommendations.some((r) => r.type === "daily_spend")).toBe(false);

    const almostEnoughResult = (await getAlertRecommendationsTool.handler({}, async () => almostEnoughHistory)) as {
      recommendations: Array<{ type: string }>;
    };
    expect(almostEnoughResult.recommendations.some((r) => r.type === "daily_spend")).toBe(false);
    expect(almostEnoughResult.recommendations.some((r) => r.type === "daily_kwh")).toBe(false);

    const withHistoryResult = (await getAlertRecommendationsTool.handler({}, async () => withHistory)) as {
      recommendations: Array<{
        type: string;
        suggestedThreshold: number | null;
        basedOnCompleteDays?: number;
      }>;
    };
    const dailySpend = withHistoryResult.recommendations.find((r) => r.type === "daily_spend");
    const dailyKwh = withHistoryResult.recommendations.find((r) => r.type === "daily_kwh");
    expect(dailySpend).toBeDefined();
    expect(dailyKwh).toBeDefined();
    // Grounded in the account's own real complete-day stats -- never the
    // flat DEFAULT_THRESHOLDS fallback, and never counting the one
    // incomplete day.
    expect(dailySpend?.suggestedThreshold).not.toBe(DEFAULT_THRESHOLDS.daily_spend);
    expect(dailyKwh?.suggestedThreshold).not.toBe(DEFAULT_THRESHOLDS.daily_kwh);
    expect(dailySpend?.basedOnCompleteDays).toBe(10);
    expect(dailyKwh?.basedOnCompleteDays).toBe(10);
  });

  it("caps recommendations to a small top set even when many are grounded, ranked with financial-risk types first", async () => {
    mocks.getAlertRulesForUser.mockResolvedValue([]);
    mocks.getLatestBalanceForUser.mockResolvedValue(120);
    mocks.getSuggestedMonthlyBudget.mockResolvedValue(1250);
    mocks.getAlertInsights.mockResolvedValue({
      runway: { estimatedDaysRemaining: 4, hasEnoughHistory: true },
      budget: { projectedSpend: null, hasEnoughHistory: false },
      tariff: { currentTariff: null },
      band: { profile: "newinbosch_2026_27", monthKwh: 120, nextBandKwh: 300, warningDistanceKwh: 25 },
      anomaly: { learningDaysSoFar: 20, minLearningDays: 14, hasEnoughHistory: true }
    });
    const context = buildTestContext(
      Array.from({ length: 10 }, (_, i) =>
        dailyRow({ periodDate: `2026-08-${String(i + 1).padStart(2, "0")}`, totalSpend: 50 + i, energyKwh: 10 + i, isComplete: true })
      ),
      [],
      { from: "", to: "" }
    );

    const result = (await getAlertRecommendationsTool.handler({}, async () => context)) as {
      recommendations: Array<{ type: string }>;
      metadata: { totalCandidates: number; capped: boolean };
    };

    expect(result.recommendations.length).toBeLessThanOrEqual(4);
    expect(result.metadata.totalCandidates).toBeGreaterThan(4);
    expect(result.metadata.capped).toBe(true);
    // low_balance and balance_runway are the highest-priority, real
    // financial-risk types -- they must survive the cap.
    expect(result.recommendations.some((r) => r.type === "low_balance")).toBe(true);
    expect(result.recommendations.some((r) => r.type === "balance_runway")).toBe(true);
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
