import { describe, expect, it } from "vitest";
import { createAnalytics } from "@/lib/analytics";
import type { DailyRollupRow, HourlyRollupRow } from "@/lib/types";

function dailyRow(overrides: Partial<DailyRollupRow>): DailyRollupRow {
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

// Three ascending days: two complete, one still in progress ("today"),
// mirroring how dashboard-data.ts always hands rows over pre-sorted by
// period_date.asc.
const day1 = dailyRow({
  periodDate: "2026-07-01",
  energySpend: 50,
  waterSpend: 5,
  fixedSpend: 10,
  totalSpend: 65,
  energyKwh: 20,
  waterKl: 1,
  balanceEnd: 500,
  latestPeriod: "2026-07-01T23:30",
  isComplete: true
});

const day2 = dailyRow({
  periodDate: "2026-07-02",
  energySpend: 80,
  waterSpend: 0,
  fixedSpend: 10,
  totalSpend: 90,
  energyKwh: 30,
  waterKl: 0,
  balanceEnd: 410,
  latestPeriod: "2026-07-02T23:30",
  isComplete: true
});

const day3InProgress = dailyRow({
  periodDate: "2026-07-03",
  energySpend: 20,
  waterSpend: 2,
  fixedSpend: 10,
  totalSpend: 32,
  energyKwh: 8,
  waterKl: 0.4,
  balanceEnd: 378,
  latestPeriod: "2026-07-03T14:30", // 14:30 -> 30 half-hour slots elapsed
  isComplete: false
});

const dailyRows = [day1, day2, day3InProgress];

function hourlyRow(overrides: Partial<HourlyRollupRow>): HourlyRollupRow {
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

const hourlyRows = [
  hourlyRow({
    periodDate: "2026-07-01",
    hour: 8,
    spend: 10,
    kwh: 4,
    waterSpend: 1,
    waterKl: 0.2,
    intervals: 2,
    waterIntervals: 2
  }),
  hourlyRow({ periodDate: "2026-07-01", hour: 18, spend: 15, kwh: 6, intervals: 2 }),
  hourlyRow({ periodDate: "2026-07-02", hour: 18, spend: 25, kwh: 10, intervals: 2 }),
  hourlyRow({
    periodDate: "2026-07-03",
    hour: 8,
    spend: 5,
    kwh: 2,
    waterSpend: 0.5,
    waterKl: 0.1,
    intervals: 1,
    waterIntervals: 1
  })
];

describe("createAnalytics totals", () => {
  it("sums spend, usage, and fixed charges across all rows", () => {
    const { metrics } = createAnalytics(dailyRows, hourlyRows);
    expect(metrics.totalSpend).toBe(187);
    expect(metrics.totalEnergySpend).toBe(150);
    expect(metrics.totalWaterSpend).toBe(7);
    expect(metrics.totalFixedSpend).toBe(30);
    expect(metrics.totalKwh).toBe(58);
    expect(metrics.totalWaterKl).toBeCloseTo(1.4, 5);
  });

  it("computes cost-per-kWh before and after fixed charges", () => {
    const { metrics } = createAnalytics(dailyRows, hourlyRows);
    expect(metrics.energyCostPerKwh).toBe(2.59); // round(150 / 58)
    expect(metrics.allInCostPerKwh).toBe(3.1); // round((150 + 30) / 58)
  });

  it("returns 0 cost-per-kWh instead of dividing by zero when there's no usage", () => {
    const { metrics } = createAnalytics([dailyRow({ energyKwh: 0, energySpend: 0 })], []);
    expect(metrics.energyCostPerKwh).toBe(0);
    expect(metrics.allInCostPerKwh).toBe(0);
  });

  it("averages by day count", () => {
    const { metrics } = createAnalytics(dailyRows, hourlyRows);
    expect(metrics.dayCount).toBe(3);
    expect(metrics.averageSpendPerDay).toBe(62.33); // round(187 / 3)
    expect(metrics.averageKwhPerDay).toBe(19.33); // round(58 / 3)
    expect(metrics.averageWaterKlPerDay).toBe(0.47); // round(1.4 / 3)
  });

  it("defaults dayCount to 1 (not 0) when there are no rows, to avoid a divide-by-zero", () => {
    const { metrics } = createAnalytics([], []);
    expect(metrics.dayCount).toBe(1);
    expect(metrics.totalSpend).toBe(0);
    expect(metrics.averageSpendPerDay).toBe(0);
  });
});

describe("createAnalytics tariff timelines", () => {
  it("builds the electricity timeline from days with energy usage, using the weighted tariff", () => {
    const { tariffTimeline } = createAnalytics(
      [
        dailyRow({ periodDate: "2026-07-01", energyKwh: 20, weightedTariff: 2.54 }),
        dailyRow({ periodDate: "2026-07-02", energyKwh: 0, weightedTariff: 0 }) // no energy -> excluded
      ],
      []
    );
    expect(tariffTimeline.map((point) => point.dateLabel)).toEqual(["2026-07-01"]);
    expect(tariffTimeline[0].tariff).toBe(2.54);
  });

  it("builds the water timeline from days with water usage, deriving tariff as spend / kL", () => {
    const { waterTariffTimeline } = createAnalytics(
      [
        dailyRow({ periodDate: "2026-07-01", waterSpend: 5, waterKl: 1 }), // 5 / 1 = 5
        dailyRow({ periodDate: "2026-07-02", waterSpend: 0, waterKl: 0 }), // no water -> excluded
        dailyRow({ periodDate: "2026-07-03", waterSpend: 2, waterKl: 0.4 }) // 2 / 0.4 = 5
      ],
      []
    );
    expect(waterTariffTimeline.map((point) => point.dateLabel)).toEqual(["2026-07-01", "2026-07-03"]);
    expect(waterTariffTimeline.map((point) => point.tariff)).toEqual([5, 5]);
  });
});

describe("createAnalytics peaks", () => {
  it("identifies the highest spend day", () => {
    const { metrics } = createAnalytics(dailyRows, hourlyRows);
    expect(metrics.highestSpendDay?.date).toBe("2026-07-02");
    expect(metrics.highestSpendDay?.spend).toBe(90);
  });

  it("identifies the highest usage day", () => {
    const { metrics } = createAnalytics(dailyRows, hourlyRows);
    expect(metrics.highestUsageDay?.date).toBe("2026-07-02");
    expect(metrics.highestUsageDay?.kwh).toBe(30);
  });

  it("identifies the highest water day even when it isn't the highest spend/usage day", () => {
    const { metrics } = createAnalytics(dailyRows, hourlyRows);
    expect(metrics.highestWaterDay?.date).toBe("2026-07-01");
    expect(metrics.highestWaterDay?.waterKl).toBe(1);
  });

  it("identifies the single highest-usage half-hour-equivalent hour by kWh, grouped per day+hour", () => {
    const { metrics } = createAnalytics(dailyRows, hourlyRows);
    // 2026-07-02 18:00 has kwh=10, the single highest bucket even though
    // 2026-07-01 has two buckets that individually total less.
    expect(metrics.highestUsageHour).toEqual({ date: "2026-07-02", hour: "18:00", spend: 25, kwh: 10 });
  });
});

describe("createAnalytics latest balance/period", () => {
  it("falls back to the last filtered row's balance and period when no summary override is given", () => {
    const { metrics } = createAnalytics(dailyRows, hourlyRows);
    expect(metrics.latestBalance).toBe(378);
    expect(metrics.latestPeriod).toBe("2026-07-03T14:30");
  });

  it("prefers the explicit summary override over the last row (summary reflects the true latest sync, which may be outside the filtered range)", () => {
    const { metrics } = createAnalytics(dailyRows, hourlyRows, undefined, undefined, {
      latestBalance: 999,
      latestPeriod: "2026-07-04T00:00"
    });
    expect(metrics.latestBalance).toBe(999);
    expect(metrics.latestPeriod).toBe("2026-07-04T00:00");
  });

  it("is undefined when there are no rows and no summary", () => {
    const { metrics } = createAnalytics([], []);
    expect(metrics.latestBalance).toBeUndefined();
    expect(metrics.latestPeriod).toBeUndefined();
  });
});

describe("createAnalytics date range filtering", () => {
  it("excludes rows outside the from/to range", () => {
    const { metrics, daily } = createAnalytics(dailyRows, hourlyRows, "2026-07-01", "2026-07-02");
    expect(daily).toHaveLength(2);
    expect(metrics.totalSpend).toBe(65 + 90);
    expect(metrics.dateStart).toBe("2026-07-01");
    expect(metrics.dateEnd).toBe("2026-07-02");
  });

  it("is inclusive of both endpoints", () => {
    const { daily } = createAnalytics(dailyRows, hourlyRows, "2026-07-02", "2026-07-02");
    expect(daily).toHaveLength(1);
    expect(daily[0].date).toBe("2026-07-02");
  });
});

describe("createAnalytics daily projections", () => {
  it("does not project spend/usage for a complete day", () => {
    const { daily } = createAnalytics(dailyRows, hourlyRows);
    const completedDay = daily.find((day) => day.date === "2026-07-01");
    expect(completedDay?.projectedSpend).toBeUndefined();
    expect(completedDay?.projectedKwh).toBeUndefined();
  });

  it("projects a full day's spend and usage once enough of an incomplete day has elapsed", () => {
    const { daily } = createAnalytics(dailyRows, hourlyRows);
    const inProgressDay = daily.find((day) => day.date === "2026-07-03");
    // 14:30 -> 30 half-hour slots elapsed. (energy+water spend 22 / 30) * 48 + fixed 10 = 45.2
    expect(inProgressDay?.projectedSpend).toBe(45.2);
    // (energyKwh 8 / 30) * 48 = 12.8
    expect(inProgressDay?.projectedKwh).toBe(12.8);
  });

  it("does not project when too little of the day has elapsed (fewer than 12 half-hour slots / 6 hours)", () => {
    const earlyDay = dailyRow({
      periodDate: "2026-07-05",
      energySpend: 5,
      totalSpend: 5,
      energyKwh: 2,
      latestPeriod: "2026-07-05T02:00", // 4 slots elapsed
      isComplete: false
    });
    const { daily } = createAnalytics([earlyDay], []);
    expect(daily[0].projectedSpend).toBeUndefined();
    expect(daily[0].projectedKwh).toBeUndefined();
  });

  it("uses completed history outside the visible range as the projection baseline", () => {
    const history = Array.from({ length: 7 }, (_, index) =>
      dailyRow({
        periodDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        energySpend: 50,
        fixedSpend: 10,
        totalSpend: 60,
        energyKwh: 20,
        energyIntervals: 48,
        isComplete: true
      })
    );
    const current = dailyRow({
      periodDate: "2026-07-08",
      energySpend: 2,
      fixedSpend: 10,
      totalSpend: 12,
      energyKwh: 0.8,
      energyIntervals: 18,
      latestPeriod: "2026-07-08T08:30",
      isComplete: false
    });
    const historyHours = history.flatMap((day) => [
      hourlyRow({ periodDate: day.periodDate, hour: 8, spend: 10, kwh: 4, intervals: 2 }),
      hourlyRow({ periodDate: day.periodDate, hour: 18, spend: 40, kwh: 16, intervals: 2 })
    ]);

    const { daily } = createAnalytics(
      [...history, current],
      [...historyHours, hourlyRow({ periodDate: current.periodDate, hour: 8, spend: 2, kwh: 0.8, intervals: 2 })],
      current.periodDate,
      current.periodDate
    );

    expect(daily).toHaveLength(1);
    expect(daily[0].projectedSpend).toBeGreaterThan(50);
    expect(daily[0].projectedSpend).toBeLessThan(60);
    expect(daily[0].projectedKwh).toBeGreaterThan(16);
  });

  it("keeps a lagging energy feed anchored to history instead of treating missing slots as zero", () => {
    const history = Array.from({ length: 7 }, (_, index) =>
      dailyRow({
        periodDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        energySpend: 50,
        waterSpend: 5,
        fixedSpend: 10,
        totalSpend: 65,
        energyKwh: 20,
        energyIntervals: 48,
        waterIntervals: 48,
        isComplete: true
      })
    );
    const current = dailyRow({
      periodDate: "2026-07-08",
      energySpend: 0,
      waterSpend: 0.5,
      fixedSpend: 10,
      totalSpend: 10.5,
      energyKwh: 0,
      energyIntervals: 0,
      waterIntervals: 18,
      latestPeriod: "2026-07-08T08:30",
      isComplete: false
    });
    const historyHours = history.flatMap((day) => [
      hourlyRow({
        periodDate: day.periodDate,
        hour: 8,
        spend: 10,
        kwh: 4,
        waterSpend: 1,
        intervals: 2,
        waterIntervals: 2
      }),
      hourlyRow({
        periodDate: day.periodDate,
        hour: 18,
        spend: 40,
        kwh: 16,
        waterSpend: 4,
        intervals: 2,
        waterIntervals: 2
      })
    ]);

    const { daily } = createAnalytics([...history, current], historyHours);

    expect(daily.at(-1)?.projectedSpend).toBeGreaterThan(60);
    expect(daily.at(-1)?.projectedKwh).toBe(20);
  });

  it("never projects a total below spend already incurred", () => {
    const history = Array.from({ length: 7 }, (_, index) =>
      dailyRow({
        periodDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        energySpend: 10,
        fixedSpend: 10,
        totalSpend: 20,
        energyKwh: 4,
        energyIntervals: 48,
        isComplete: true
      })
    );
    const current = dailyRow({
      periodDate: "2026-07-08",
      energySpend: 70,
      fixedSpend: 10,
      totalSpend: 80,
      energyKwh: 28,
      energyIntervals: 18,
      latestPeriod: "2026-07-08T08:30",
      isComplete: false
    });

    const { daily } = createAnalytics([...history, current], []);

    expect(daily.at(-1)?.projectedSpend).toBeGreaterThanOrEqual(80);
    expect(daily.at(-1)?.projectedKwh).toBeGreaterThanOrEqual(28);
  });

  it("does not project an old incomplete day when newer data exists", () => {
    const oldIncomplete = dailyRow({
      periodDate: "2026-07-01",
      energySpend: 20,
      fixedSpend: 10,
      totalSpend: 30,
      energyIntervals: 20,
      latestPeriod: "2026-07-01T09:30",
      isComplete: false
    });
    const newerComplete = dailyRow({
      periodDate: "2026-07-02",
      energySpend: 40,
      fixedSpend: 10,
      totalSpend: 50,
      energyIntervals: 48,
      isComplete: true
    });

    const { daily } = createAnalytics([oldIncomplete, newerComplete], []);

    expect(daily[0].projectedSpend).toBeUndefined();
  });

  it("tracks a running cumulative spend total across the sorted days", () => {
    const { daily } = createAnalytics(dailyRows, hourlyRows);
    expect(daily.map((day) => day.cumulativeSpend)).toEqual([65, 155, 187]);
  });
});

describe("createAnalytics insights", () => {
  it("includes a fixed-charges insight when fixed spend is present", () => {
    const { insights } = createAnalytics(dailyRows, hourlyRows);
    expect(insights.some((insight) => insight.title === "Fixed charges")).toBe(true);
  });

  it("includes a water-charges insight when water spend or usage is present", () => {
    const { insights } = createAnalytics(dailyRows, hourlyRows);
    expect(insights.some((insight) => insight.title === "Water charges")).toBe(true);
  });

  it("omits the water-charges insight when there's no water activity at all", () => {
    const noWaterDay = dailyRow({ periodDate: "2026-07-01", energySpend: 10, totalSpend: 10, energyKwh: 5 });
    const { insights } = createAnalytics([noWaterDay], []);
    expect(insights.some((insight) => insight.title === "Water charges")).toBe(false);
  });

  it("returns an empty insights array (not a throw) for an empty range", () => {
    const { insights } = createAnalytics([], []);
    expect(insights).toEqual([]);
  });
});
