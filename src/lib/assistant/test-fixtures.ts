import { createAnalytics } from "@/lib/analytics";
import type { DailyRollupRow, HourlyRollupRow } from "@/lib/types";
import type { DashboardContext } from "./types";

export function dailyRow(overrides: Partial<DailyRollupRow>): DailyRollupRow {
  return {
    periodDate: "2026-07-01",
    energySpend: 0,
    waterSpend: 0,
    fixedSpend: 0,
    topupAmount: 0,
    totalSpend: 0,
    energyKwh: 0,
    waterKl: 0,
    weightedTariff: 0,
    peakTariff: 0,
    allInRate: 0,
    balanceEnd: 0,
    energyIntervals: 0,
    waterIntervals: 0,
    isComplete: true,
    ...overrides
  };
}

export function hourlyRow(overrides: Partial<HourlyRollupRow>): HourlyRollupRow {
  return {
    periodDate: "2026-07-01",
    hour: 0,
    spend: 0,
    kwh: 0,
    waterSpend: 0,
    waterKl: 0,
    intervals: 0,
    waterIntervals: 0,
    ...overrides
  };
}

export function buildTestContext(
  dailyRows: DailyRollupRow[],
  hourlyRows: HourlyRollupRow[] = [],
  scope: { from: string; to: string } = { from: "", to: "" },
  overrides: Partial<DashboardContext> = {}
): DashboardContext {
  return {
    accessToken: "test-token",
    userId: "test-user-id",
    permissions: { activitiesEnabled: false, alertsEnabled: false },
    summary: {},
    dailyRows,
    hourlyRows,
    analytics: createAnalytics(dailyRows, hourlyRows, scope.from || undefined, scope.to || undefined),
    scope,
    ...overrides
  };
}
