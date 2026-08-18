// Ties the synthetic dataset generator to the real analytics/assistant code
// paths: rolls the generated raw rows up the same way
// refresh_newinmeter_rollups_for_run does in Postgres (see that migration),
// then feeds the result through the actual createAnalytics() and a handful
// of real assistant tool handlers -- the same functions the dashboard and
// the assistant use against a live database. This is what "seeded data
// produces meaningful analytics" and "assistant tools work against
// representative seeded data" mean in practice without standing up Supabase.
import { describe, expect, it } from "vitest";
import { compareCalendarMonthsTool } from "@/lib/assistant/tools/compare-calendar-months";
import { getBalanceRunoutTool } from "@/lib/assistant/tools/get-balance-runout";
import type { DashboardContext } from "@/lib/assistant/types";
import { createAnalytics } from "@/lib/analytics";
import type { DailyRollupRow, HourlyRollupRow } from "@/lib/types";
import { buildDemoDataset, type DemoEnergyRow } from "./dataset";

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function isEnergy(row: DemoEnergyRow) {
  return row.chargeLabel.startsWith("Energy Charge:");
}
function isWater(row: DemoEnergyRow) {
  return row.chargeLabel.startsWith("Water:");
}
function isFixed(row: DemoEnergyRow) {
  return row.chargeLabel === "Basic Charge";
}
function isTopup(row: DemoEnergyRow) {
  return row.chargeLabel === "Top Up";
}

function periodDate(row: DemoEnergyRow) {
  return row.periodDt.slice(0, 10);
}
function periodHour(row: DemoEnergyRow) {
  return Number(row.periodDt.slice(11, 13));
}

// Mirrors refresh_newinmeter_rollups_for_run's per-day aggregation
// (supabase/migrations/20260809010000_newinmeter_spend_excludes_credits.sql)
// closely enough to exercise the same downstream analytics/assistant code
// against seeded rows, without a live Postgres instance.
function buildRollupsFromEnergyRows(rows: DemoEnergyRow[]): {
  daily: DailyRollupRow[];
  hourly: HourlyRollupRow[];
} {
  const byDate = new Map<string, DemoEnergyRow[]>();
  for (const row of rows) {
    const date = periodDate(row);
    const bucket = byDate.get(date) ?? [];
    bucket.push(row);
    byDate.set(date, bucket);
  }

  const daily: DailyRollupRow[] = Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, dayRows]) => {
      const energyRows = dayRows.filter(isEnergy);
      const waterRows = dayRows.filter(isWater);
      const fixedRows = dayRows.filter(isFixed);
      const topupRows = dayRows.filter(isTopup);
      const energySpend = round(
        energyRows.reduce((sum, row) => sum + row.cost, 0),
        2
      );
      const waterSpend = round(
        waterRows.reduce((sum, row) => sum + row.cost, 0),
        2
      );
      const fixedSpend = round(
        fixedRows.reduce((sum, row) => sum + row.cost, 0),
        2
      );
      const topupAmount = round(
        topupRows.reduce((sum, row) => sum + row.cost, 0),
        2
      );
      const energyKwh = round(
        energyRows.reduce((sum, row) => sum + row.kwh, 0),
        4
      );
      const waterKl = round(
        waterRows.reduce((sum, row) => sum + row.waterKl, 0),
        4
      );
      const weightedTariff = energyKwh
        ? round(energyRows.reduce((sum, row) => sum + row.kwh * row.tariff, 0) / energyKwh, 4)
        : 0;
      const peakTariff = energyRows.length ? round(Math.max(...energyRows.map((row) => row.tariff)), 4) : 0;
      const lastRow = dayRows.slice().sort((left, right) => (left.periodDt < right.periodDt ? -1 : 1))[
        dayRows.length - 1
      ];

      return {
        periodDate: date,
        energySpend,
        waterSpend,
        fixedSpend,
        topupAmount,
        totalSpend: round(energySpend + waterSpend + fixedSpend, 2),
        energyKwh,
        waterKl,
        weightedTariff,
        peakTariff,
        allInRate: energyKwh ? round((energySpend + fixedSpend) / energyKwh, 4) : 0,
        balanceEnd: lastRow.balance,
        latestPeriod: lastRow.periodDt,
        energyIntervals: energyRows.length,
        waterIntervals: waterRows.length,
        isComplete: energyRows.length >= 48
      };
    });

  const byDateHour = new Map<string, DemoEnergyRow[]>();
  for (const row of rows) {
    if (!isEnergy(row) && !isWater(row)) continue;
    const key = `${periodDate(row)}#${periodHour(row)}`;
    const bucket = byDateHour.get(key) ?? [];
    bucket.push(row);
    byDateHour.set(key, bucket);
  }

  const hourly: HourlyRollupRow[] = Array.from(byDateHour.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, hourRows]) => {
      const [date, hourStr] = key.split("#");
      const energyRows = hourRows.filter(isEnergy);
      const waterRows = hourRows.filter(isWater);
      return {
        periodDate: date,
        hour: Number(hourStr),
        spend: round(
          energyRows.reduce((sum, row) => sum + row.cost, 0),
          2
        ),
        kwh: round(
          energyRows.reduce((sum, row) => sum + row.kwh, 0),
          4
        ),
        waterSpend: round(
          waterRows.reduce((sum, row) => sum + row.cost, 0),
          2
        ),
        waterKl: round(
          waterRows.reduce((sum, row) => sum + row.waterKl, 0),
          4
        ),
        intervals: energyRows.length,
        waterIntervals: waterRows.length
      };
    });

  return { daily, hourly };
}

describe("seeded demo data through the real analytics/assistant path", () => {
  const dataset = buildDemoDataset({ startDate: "2026-06-01", days: 70 });
  const { daily, hourly } = buildRollupsFromEnergyRows(dataset.energyRows);
  const analytics = createAnalytics(daily, hourly, dataset.meta.startDate, dataset.meta.endDate);

  it("produces a full 70-day rollup with every day complete", () => {
    expect(daily).toHaveLength(70);
    expect(daily.every((day) => day.isComplete)).toBe(true);
  });

  it("createAnalytics derives meaningful totals and a highest-usage day", () => {
    expect(analytics.metrics.totalSpend).toBeGreaterThan(0);
    expect(analytics.metrics.totalKwh).toBeGreaterThan(0);
    expect(analytics.metrics.totalWaterKl).toBeGreaterThan(0);
    expect(analytics.metrics.highestUsageDay?.date).toBeTruthy();
  });

  it("surfaces the short spike as a hugely elevated hour, distinct from the 'high usage day' totals", () => {
    // The spike is deliberately two half-hour intervals, not a whole elevated
    // day (that's what the separate "high usage days" are for) -- so the
    // signal to check is the spike hour's rollup, not the day's total kwh.
    const spikeHour = analytics.hourly.filter((point) => point.hour === "13:00");
    const spikeDayHourly = hourly.find((row) => row.periodDate === dataset.meta.spikeDate && row.hour === 13);
    const otherHourlyAtSameHour = hourly.filter((row) => row.hour === 13 && row.periodDate !== dataset.meta.spikeDate);
    const averageOtherKwh = otherHourlyAtSameHour.reduce((sum, row) => sum + row.kwh, 0) / otherHourlyAtSameHour.length;

    expect(spikeHour.length).toBeGreaterThan(0);
    expect(spikeDayHourly?.kwh ?? 0).toBeGreaterThan(averageOtherKwh * 5);
  });

  it("get_balance_runout produces a real projection from seeded rollups", async () => {
    const context: DashboardContext = {
      accessToken: "test",
      summary: { latestBalance: daily[daily.length - 1].balanceEnd, dateEnd: dataset.meta.endDate },
      dailyRows: daily,
      hourlyRows: hourly,
      analytics,
      scope: { from: dataset.meta.startDate, to: dataset.meta.endDate }
    };
    const result = (await getBalanceRunoutTool.handler({}, async () => context)) as {
      available: boolean;
      daysRemaining?: number;
    };
    expect(result.available).toBe(true);
    expect(result.daysRemaining).toBeGreaterThan(0);
  });

  it("compare_calendar_months finds two distinct, comparable months in the seeded range", async () => {
    const context: DashboardContext = {
      accessToken: "test",
      summary: { dateStart: dataset.meta.startDate, dateEnd: dataset.meta.endDate },
      dailyRows: daily,
      hourlyRows: hourly,
      analytics,
      scope: { from: dataset.meta.startDate, to: dataset.meta.endDate }
    };
    const result = (await compareCalendarMonthsTool.handler({}, async () => context)) as {
      current: { spend: number } | null;
      previous: { spend: number } | null;
      deltas: unknown;
    };
    expect(result.current).not.toBeNull();
    expect(result.previous).not.toBeNull();
    expect(result.current?.spend).toBeGreaterThan(0);
    expect(result.previous?.spend).toBeGreaterThan(0);
    expect(result.deltas).not.toBeNull();
  });
});
