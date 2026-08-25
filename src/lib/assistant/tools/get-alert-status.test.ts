import { describe, expect, it, vi } from "vitest";
import { ALERT_TYPES, DEFAULT_THRESHOLDS, FRESH_DATA_ALERT_TYPES } from "@/lib/newinmeter/alert-types";
import type { AlertRule } from "@/lib/newinmeter/alerts";
import { dailyRow, buildTestContext } from "../test-fixtures";
import { getAlertStatusTool } from "./get-alert-status";

const mocks = vi.hoisted(() => ({
  getAlertRulesForUser: vi.fn(),
  getAlertInsights: vi.fn(),
  getLatestBalanceForUser: vi.fn(),
  getConnectionForUser: vi.fn()
}));

// Mocking the whole alerts.ts module (rather than importing it for real)
// keeps this a focused unit test of get-alert-status's OWN aggregation
// logic, and sidesteps needing the react cache()/features shim that
// alerts.ts's real module graph requires (see alerts.test.ts's own comment
// on that) -- the pure constant exports are re-exported as-is since the
// handler's switch/loop depends on their real values.
vi.mock("@/lib/newinmeter/alerts", () => ({
  ALERT_TYPES,
  DEFAULT_THRESHOLDS,
  FRESH_DATA_ALERT_TYPES,
  getAlertRulesForUser: mocks.getAlertRulesForUser,
  getAlertInsights: mocks.getAlertInsights,
  getLatestBalanceForUser: mocks.getLatestBalanceForUser
}));
vi.mock("@/lib/newinmeter/connection", () => ({ getConnectionForUser: mocks.getConnectionForUser }));
// currentLocalDateString(new Date()) is real wall-clock time -- stubbed to a
// fixed date so "today" in these tests never depends on when the suite runs.
vi.mock("@/lib/newinmeter/schedule", () => ({ currentLocalDateString: () => "2026-08-20" }));

function rule(overrides: Partial<AlertRule>): AlertRule {
  return {
    id: "rule-1",
    connectionId: "conn-1",
    type: "low_balance",
    enabled: true,
    threshold: 200,
    updatedAt: "",
    ...overrides
  };
}

describe("get_alert_status", () => {
  it("returns one status entry per known alert type, in ALERT_TYPES order", async () => {
    mocks.getAlertRulesForUser.mockResolvedValue([]);
    mocks.getAlertInsights.mockResolvedValue(null);
    mocks.getLatestBalanceForUser.mockResolvedValue(null);
    mocks.getConnectionForUser.mockResolvedValue(null);

    const context = buildTestContext([], [], { from: "", to: "" });
    const result = (await getAlertStatusTool.handler({}, async () => context)) as { alerts: Array<{ type: string }> };

    expect(result.alerts.map((entry) => entry.type)).toEqual(ALERT_TYPES);
  });

  it("marks a type disabled with no threshold when no rule exists for it, and enabled with its threshold when one does", async () => {
    mocks.getAlertRulesForUser.mockResolvedValue([rule({ type: "low_balance", enabled: true, threshold: 300 })]);
    mocks.getAlertInsights.mockResolvedValue(null);
    mocks.getLatestBalanceForUser.mockResolvedValue(150);
    mocks.getConnectionForUser.mockResolvedValue(null);

    const context = buildTestContext([], [], { from: "", to: "" });
    const result = (await getAlertStatusTool.handler({}, async () => context)) as {
      alerts: Array<{ type: string; enabled: boolean; threshold: number | null; currentValue: number | null }>;
    };

    const lowBalance = result.alerts.find((entry) => entry.type === "low_balance")!;
    expect(lowBalance.enabled).toBe(true);
    expect(lowBalance.threshold).toBe(300);
    expect(lowBalance.currentValue).toBe(150);

    const dailySpend = result.alerts.find((entry) => entry.type === "daily_spend")!;
    expect(dailySpend.enabled).toBe(false);
    expect(dailySpend.threshold).toBeNull();
  });

  it("reads today's spend/kWh from the already-loaded dashboard context, not a fresh admin query", async () => {
    mocks.getAlertRulesForUser.mockResolvedValue([rule({ type: "daily_spend", threshold: 50 })]);
    mocks.getAlertInsights.mockResolvedValue(null);
    mocks.getLatestBalanceForUser.mockResolvedValue(null);
    mocks.getConnectionForUser.mockResolvedValue(null);

    const today = "2026-08-20";
    const context = buildTestContext([dailyRow({ periodDate: today, totalSpend: 87.5, energyKwh: 12.3 })], [], {
      from: today,
      to: today
    });
    const result = (await getAlertStatusTool.handler({}, async () => context)) as {
      alerts: Array<{ type: string; currentValue: number | null }>;
    };

    expect(result.alerts.find((entry) => entry.type === "daily_spend")?.currentValue).toBe(87.5);
    expect(result.alerts.find((entry) => entry.type === "daily_kwh")?.currentValue).toBe(12.3);
  });

  it("includes dedupSemantics describing correlated suppression, for grounded 'why didn't I get another alert' answers", async () => {
    mocks.getAlertRulesForUser.mockResolvedValue([]);
    mocks.getAlertInsights.mockResolvedValue(null);
    mocks.getLatestBalanceForUser.mockResolvedValue(null);
    mocks.getConnectionForUser.mockResolvedValue(null);

    const context = buildTestContext([], [], { from: "", to: "" });
    const result = (await getAlertStatusTool.handler({}, async () => context)) as {
      dedupSemantics: Record<string, string>;
    };

    expect(result.dedupSemantics.correlated_suppression).toContain("balance_runway");
    expect(result.dedupSemantics.daily_spend.toLowerCase()).toContain("once per");
  });

  it("surfaces autoSyncEnabled from the connection so the model can explain why a fresh-data alert isn't firing", async () => {
    mocks.getAlertRulesForUser.mockResolvedValue([]);
    mocks.getAlertInsights.mockResolvedValue(null);
    mocks.getLatestBalanceForUser.mockResolvedValue(null);
    mocks.getConnectionForUser.mockResolvedValue({ autoSyncEnabled: false, lastSyncedAt: "2026-08-20T10:00:00Z" });

    const context = buildTestContext([], [], { from: "", to: "" });
    const result = (await getAlertStatusTool.handler({}, async () => context)) as { autoSyncEnabled: boolean };

    expect(result.autoSyncEnabled).toBe(false);
  });

  describe("deterministic direction/conditionMet -- the model never does this arithmetic itself", () => {
    type StatusEntry = {
      type: string;
      threshold: number | null;
      currentValue: number | null;
      conditionMet: boolean | null;
      direction: "above" | "below" | null;
      differenceFromThreshold: number | null;
    };

    it("R92.84 balance against a R300 threshold is correctly 'below', never 'above' -- the exact regression case", async () => {
      mocks.getAlertRulesForUser.mockResolvedValue([rule({ type: "low_balance", enabled: true, threshold: 300 })]);
      mocks.getAlertInsights.mockResolvedValue(null);
      mocks.getLatestBalanceForUser.mockResolvedValue(92.84);
      mocks.getConnectionForUser.mockResolvedValue(null);

      const context = buildTestContext([], [], { from: "", to: "" });
      const result = (await getAlertStatusTool.handler({}, async () => context)) as { alerts: StatusEntry[] };
      const lowBalance = result.alerts.find((entry) => entry.type === "low_balance")!;

      expect(lowBalance.direction).toBe("below");
      expect(lowBalance.conditionMet).toBe(true);
      expect(lowBalance.differenceFromThreshold).toBeCloseTo(92.84 - 300, 2);
    });

    it("a balance ABOVE the low_balance threshold reports direction 'above' and conditionMet false", async () => {
      mocks.getAlertRulesForUser.mockResolvedValue([rule({ type: "low_balance", enabled: true, threshold: 300 })]);
      mocks.getAlertInsights.mockResolvedValue(null);
      mocks.getLatestBalanceForUser.mockResolvedValue(450);
      mocks.getConnectionForUser.mockResolvedValue(null);

      const context = buildTestContext([], [], { from: "", to: "" });
      const result = (await getAlertStatusTool.handler({}, async () => context)) as { alerts: StatusEntry[] };
      const lowBalance = result.alerts.find((entry) => entry.type === "low_balance")!;

      expect(lowBalance.direction).toBe("above");
      expect(lowBalance.conditionMet).toBe(false);
    });

    it("daily_spend fires on crossing ABOVE its threshold, not below -- opposite fire direction from low_balance", async () => {
      mocks.getAlertRulesForUser.mockResolvedValue([rule({ type: "daily_spend", enabled: true, threshold: 50 })]);
      mocks.getAlertInsights.mockResolvedValue(null);
      mocks.getLatestBalanceForUser.mockResolvedValue(null);
      mocks.getConnectionForUser.mockResolvedValue(null);

      const today = "2026-08-20";
      const context = buildTestContext([dailyRow({ periodDate: today, totalSpend: 87.5 })], [], {
        from: today,
        to: today
      });
      const result = (await getAlertStatusTool.handler({}, async () => context)) as { alerts: StatusEntry[] };
      const dailySpend = result.alerts.find((entry) => entry.type === "daily_spend")!;

      expect(dailySpend.direction).toBe("above");
      expect(dailySpend.conditionMet).toBe(true);
    });

    it("balance_runway fires at-or-below the threshold (not strictly below)", async () => {
      mocks.getAlertRulesForUser.mockResolvedValue([rule({ type: "balance_runway", enabled: true, threshold: 5 })]);
      mocks.getAlertInsights.mockResolvedValue({
        runway: { estimatedDaysRemaining: 5, hasEnoughHistory: true },
        budget: { projectedSpend: null, hasEnoughHistory: false },
        tariff: { currentTariff: null },
        band: { profile: null, monthKwh: 0, nextBandKwh: null, warningDistanceKwh: null },
        anomaly: { learningDaysSoFar: 0, minLearningDays: 14, hasEnoughHistory: false }
      });
      mocks.getLatestBalanceForUser.mockResolvedValue(null);
      mocks.getConnectionForUser.mockResolvedValue(null);

      const context = buildTestContext([], [], { from: "", to: "" });
      const result = (await getAlertStatusTool.handler({}, async () => context)) as { alerts: StatusEntry[] };
      const runway = result.alerts.find((entry) => entry.type === "balance_runway")!;

      expect(runway.conditionMet).toBe(true);
    });

    it("leaves conditionMet/direction/differenceFromThreshold null when there is no threshold or no current value to compare", async () => {
      mocks.getAlertRulesForUser.mockResolvedValue([]);
      mocks.getAlertInsights.mockResolvedValue(null);
      mocks.getLatestBalanceForUser.mockResolvedValue(null);
      mocks.getConnectionForUser.mockResolvedValue(null);

      const context = buildTestContext([], [], { from: "", to: "" });
      const result = (await getAlertStatusTool.handler({}, async () => context)) as { alerts: StatusEntry[] };
      const lowBalance = result.alerts.find((entry) => entry.type === "low_balance")!;

      expect(lowBalance.conditionMet).toBeNull();
      expect(lowBalance.direction).toBeNull();
      expect(lowBalance.differenceFromThreshold).toBeNull();
    });
  });
});
