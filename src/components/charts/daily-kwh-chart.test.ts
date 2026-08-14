import { describe, expect, it } from "vitest";
import { buildDailyKwhChartModel, groupActivitiesByDate } from "./daily-kwh-chart-model";
import type { DailyPoint, UsageActivity } from "@/lib/types";

function point(overrides: Partial<DailyPoint>): DailyPoint {
  return {
    date: "2026-08-01",
    spend: 0,
    kwh: 0,
    waterSpend: 0,
    waterKl: 0,
    averageTariff: 0,
    balance: 0,
    cumulativeSpend: 0,
    energyIntervals: 48,
    waterIntervals: 48,
    isComplete: true,
    ...overrides
  };
}

describe("buildDailyKwhChartModel", () => {
  it("keeps the projected total and derives only the remainder for the stacked bar", () => {
    const projected = point({ kwh: 4, projectedKwh: 10, isComplete: false });
    const { chartData } = buildDailyKwhChartModel([projected]);

    expect(chartData[0].projectedKwh).toBe(10);
    expect(chartData[0].projectedKwhRemainder).toBe(6);
  });

  it("never renders a negative projected remainder", () => {
    const projected = point({ kwh: 10, projectedKwh: 8, isComplete: false });
    const { chartData } = buildDailyKwhChartModel([projected]);

    expect(chartData[0].projectedKwhRemainder).toBe(0);
  });

  it("excludes today's partial usage from the historical average", () => {
    const { completedDays, averageKwh } = buildDailyKwhChartModel([
      point({ date: "2026-08-01", kwh: 10 }),
      point({ date: "2026-08-02", kwh: 20 }),
      point({ date: "2026-08-03", kwh: 2, projectedKwh: 18, isComplete: false })
    ]);

    expect(completedDays).toHaveLength(2);
    expect(averageKwh).toBe(15);
  });
});

describe("daily usage activity markers", () => {
  it("groups tagged activities on the date whose usage bar receives a marker", () => {
    const activity = {
      id: "a",
      startsAt: "2026-08-04T18:00:00",
      endsAt: "2026-08-04T20:30:00",
      allDay: false,
      tags: ["geyser"],
      color: "#0f766e",
      createdAt: "",
      updatedAt: ""
    } satisfies UsageActivity;
    expect(groupActivitiesByDate([activity])).toEqual({ "2026-08-04": [activity] });
  });
});
