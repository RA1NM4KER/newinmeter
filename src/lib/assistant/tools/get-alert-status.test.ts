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
});
