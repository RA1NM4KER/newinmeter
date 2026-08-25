import { describe, expect, it, vi } from "vitest";
import { dailyRow, buildTestContext } from "../test-fixtures";
import { inspectTimeWindowTool } from "./inspect-time-window";

const { loadDayIntervalRollupsMock, loadActivityReportMock } = vi.hoisted(() => ({
  loadDayIntervalRollupsMock: vi.fn(),
  loadActivityReportMock: vi.fn()
}));
vi.mock("@/lib/dashboard-data", () => ({ loadDayIntervalRollups: loadDayIntervalRollupsMock }));
vi.mock("@/lib/activity/data", () => ({ loadActivityReport: loadActivityReportMock }));

function interval(periodTime: string, kwh: number, spend = kwh * 3) {
  return { periodDate: "2026-08-20", periodTime, kwh, spend, waterKl: 0, waterSpend: 0 };
}

describe("inspect_time_window", () => {
  it("answers the REQUESTED window directly with real half-hour interval totals", async () => {
    loadDayIntervalRollupsMock.mockResolvedValue([
      interval("18:30", 1.0),
      interval("19:00", 2.5),
      interval("19:30", 1.5),
      interval("20:00", 0.5)
    ]);
    const context = buildTestContext([dailyRow({ periodDate: "2026-08-20", isComplete: true })], [], {
      from: "2026-08-01",
      to: "2026-08-20"
    });

    const result = (await inspectTimeWindowTool.handler(
      { date: "2026-08-20", startTime: "19:00", endTime: "20:00", includeTypicalComparison: false },
      async () => context
    )) as { window_kwh: number; intervals: Array<{ time: string }> };

    expect(result.window_kwh).toBe(4);
    expect(result.intervals.map((i) => i.time)).toEqual(["19:00", "19:30"]);
  });

  it("rejects an invalid time range where startTime is not before endTime", async () => {
    const context = buildTestContext([], [], { from: "", to: "" });
    const result = (await inspectTimeWindowTool.handler(
      { date: "2026-08-20", startTime: "20:00", endTime: "19:00", includeTypicalComparison: false },
      async () => context
    )) as { error?: string };
    expect(result.error).toBe("invalid_time_range");
  });

  it("rejects a malformed date", async () => {
    const context = buildTestContext([], [], { from: "", to: "" });
    const result = (await inspectTimeWindowTool.handler(
      { date: "not-a-date", startTime: "19:00", endTime: "20:00", includeTypicalComparison: false },
      async () => context
    )) as { error?: string };
    expect(result.error).toBe("invalid_date");
  });

  it("only fetches overlapping Activities when Activities is enabled for the account", async () => {
    loadDayIntervalRollupsMock.mockResolvedValue([interval("19:00", 1)]);
    const context = buildTestContext([dailyRow({ periodDate: "2026-08-20" })], [], { from: "", to: "" }, {
      permissions: { activitiesEnabled: false, alertsEnabled: false }
    });

    const result = (await inspectTimeWindowTool.handler(
      { date: "2026-08-20", startTime: "19:00", endTime: "20:00", includeTypicalComparison: false },
      async () => context
    )) as { overlappingActivities: unknown[] };

    expect(loadActivityReportMock).not.toHaveBeenCalled();
    expect(result.overlappingActivities).toEqual([]);
  });

  it("includes an overlapping Activity when Activities is enabled and its window intersects the requested one", async () => {
    loadDayIntervalRollupsMock.mockResolvedValue([interval("19:00", 1)]);
    loadActivityReportMock.mockResolvedValue({
      rows: [{ startsAt: "2026-08-20T18:30:00", endsAt: "2026-08-20T19:30:00", tags: ["geyser"] }]
    });
    const context = buildTestContext([dailyRow({ periodDate: "2026-08-20" })], [], { from: "", to: "" }, {
      permissions: { activitiesEnabled: true, alertsEnabled: false }
    });

    const result = (await inspectTimeWindowTool.handler(
      { date: "2026-08-20", startTime: "19:00", endTime: "20:00", includeTypicalComparison: false },
      async () => context
    )) as { overlappingActivities: Array<{ tags: string[] }> };

    expect(result.overlappingActivities).toHaveLength(1);
    expect(result.overlappingActivities[0].tags).toEqual(["geyser"]);
  });

  it("only offers a typical-same-time comparison once there are enough COMPLETE days in scope", async () => {
    loadDayIntervalRollupsMock.mockResolvedValue([interval("19:00", 2)]);
    // Only 3 complete days -- below MIN_COMPARISON_DAYS.
    const fewCompleteDays = buildTestContext(
      [
        dailyRow({ periodDate: "2026-08-16", isComplete: true }),
        dailyRow({ periodDate: "2026-08-17", isComplete: true }),
        dailyRow({ periodDate: "2026-08-18", isComplete: true }),
        dailyRow({ periodDate: "2026-08-20", isComplete: true })
      ],
      [],
      { from: "2026-08-01", to: "2026-08-20" }
    );

    const result = (await inspectTimeWindowTool.handler(
      { date: "2026-08-20", startTime: "19:00", endTime: "20:00", includeTypicalComparison: true },
      async () => fewCompleteDays
    )) as { typicalComparison: unknown };

    expect(result.typicalComparison).toBeNull();
  });

  it("computes a typical-same-time comparison across other complete days once there are enough of them", async () => {
    loadDayIntervalRollupsMock.mockImplementation(async () => [interval("19:00", 2)]);
    const dates = ["2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-20"];
    const manyCompleteDays = buildTestContext(
      dates.map((periodDate) => dailyRow({ periodDate, isComplete: true })),
      [],
      { from: "2026-08-01", to: "2026-08-20" }
    );

    const result = (await inspectTimeWindowTool.handler(
      { date: "2026-08-20", startTime: "19:00", endTime: "20:00", includeTypicalComparison: true },
      async () => manyCompleteDays
    )) as { typicalComparison: { averageKwh: number; basedOnDays: number } | null };

    expect(result.typicalComparison).not.toBeNull();
    expect(result.typicalComparison?.basedOnDays).toBe(5);
    expect(result.typicalComparison?.averageKwh).toBe(2);
  });
});
