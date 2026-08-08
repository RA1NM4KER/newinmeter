import { describe, expect, it } from "vitest";
import {
  buildGlobalDomains,
  buildIntervalPoints,
  buildStableAxisDomains,
  roundedCeiling,
  sumRows
} from "@/lib/day-breakdown";
import type { IntervalRollupRow } from "@/lib/types";

function row(overrides: Partial<IntervalRollupRow>): IntervalRollupRow {
  return {
    periodDate: "2026-07-25",
    periodTime: "00:00",
    spend: 0,
    kwh: 0,
    waterSpend: 0,
    waterKl: 0,
    ...overrides
  };
}

describe("buildIntervalPoints", () => {
  it("always returns 48 half-hour slots for a day", () => {
    const points = buildIntervalPoints([], "2026-07-25");
    expect(points).toHaveLength(48);
    expect(points[0].time).toBe("00:00");
    expect(points[1].time).toBe("00:30");
    expect(points[47].time).toBe("23:30");
  });

  it("fills in real values for slots that have data", () => {
    const rows = [row({ periodTime: "08:00", spend: 5, kwh: 2 })];
    const points = buildIntervalPoints(rows, "2026-07-25");
    const slot = points.find((point) => point.time === "08:00");
    expect(slot).toEqual({ time: "08:00", spend: 5, kwh: 2, waterSpend: null, waterKl: null });
  });

  it("leaves slots with no captured row as null rather than 0", () => {
    const rows = [row({ periodTime: "08:00", spend: 5, kwh: 2 })];
    const points = buildIntervalPoints(rows, "2026-07-25");
    const untouched = points.find((point) => point.time === "09:00");
    expect(untouched).toEqual({ time: "09:00", spend: null, kwh: null, waterSpend: null, waterKl: null });
  });

  it("only includes rows matching the selected date", () => {
    const rows = [
      row({ periodDate: "2026-07-24", periodTime: "08:00", spend: 99, kwh: 99 }),
      row({ periodDate: "2026-07-25", periodTime: "08:00", spend: 5, kwh: 2 })
    ];
    const points = buildIntervalPoints(rows, "2026-07-25");
    const slot = points.find((point) => point.time === "08:00");
    expect(slot?.spend).toBe(5);
  });

  it("sums multiple rows landing in the same slot", () => {
    const rows = [row({ periodTime: "08:00", spend: 5, kwh: 2 }), row({ periodTime: "08:00", spend: 3, kwh: 1 })];
    const points = buildIntervalPoints(rows, "2026-07-25");
    const slot = points.find((point) => point.time === "08:00");
    expect(slot).toEqual({ time: "08:00", spend: 8, kwh: 3, waterSpend: null, waterKl: null });
  });

  it("tracks electricity and water cutoffs independently within the same slot", () => {
    // Electricity stopped reporting for the day, but water kept going --
    // the rollup groups both utilities under one period_time row, so each
    // utility's own fields must decide its own null-vs-value cutoff.
    const rows = [row({ periodTime: "08:00", spend: 0, kwh: 0, waterSpend: 4, waterKl: 1 })];
    const points = buildIntervalPoints(rows, "2026-07-25");
    const slot = points.find((point) => point.time === "08:00");
    expect(slot).toEqual({ time: "08:00", spend: null, kwh: null, waterSpend: 4, waterKl: 1 });
  });

  it("rounds summed values to 2 decimal places", () => {
    const rows = [row({ periodTime: "08:00", spend: 0.1, kwh: 0 }), row({ periodTime: "08:00", spend: 0.2, kwh: 0 })];
    const points = buildIntervalPoints(rows, "2026-07-25");
    const slot = points.find((point) => point.time === "08:00");
    // 0.1 + 0.2 === 0.30000000000000004 in floating point -- confirms the
    // rounding step actually cleans that up instead of leaking it through.
    expect(slot?.spend).toBe(0.3);
  });
});

describe("sumRows", () => {
  it("sums a single field across rows", () => {
    const rows = [row({ spend: 1 }), row({ spend: 2 }), row({ spend: 3 })];
    expect(sumRows(rows, "spend")).toBe(6);
  });

  it("returns 0 for an empty list", () => {
    expect(sumRows([], "kwh")).toBe(0);
  });
});

describe("buildStableAxisDomains", () => {
  it("returns the minimum step as a floor even with no data", () => {
    expect(buildStableAxisDomains([])).toEqual({ spend: 1, kwh: 0.5, waterSpend: 0.1, waterKl: 0.05 });
  });

  it("rounds the max single-interval total up to the nearest step", () => {
    // Two rows land in the same period_date+period_time slot and get
    // combined before computing the max -- 3.1 + 0.05 = 3.15 spend in one
    // interval, which should ceil up to the next R1 step (4), not round the
    // individual row values independently.
    const rows = [
      row({ periodTime: "08:00", spend: 3.1, kwh: 1.1 }),
      row({ periodTime: "08:00", spend: 0.05, kwh: 0.1 })
    ];
    const domains = buildStableAxisDomains(rows);
    expect(domains.spend).toBe(4);
    expect(domains.kwh).toBe(1.5);
  });

  it("takes the max across different intervals, not the sum", () => {
    const rows = [row({ periodTime: "08:00", spend: 2 }), row({ periodTime: "09:00", spend: 5 })];
    expect(buildStableAxisDomains(rows).spend).toBe(5);
  });
});

describe("buildGlobalDomains", () => {
  it("ceils each input to its own step size", () => {
    expect(buildGlobalDomains(2.1, 3.6, 0.15, 0.02)).toEqual({
      spend: 3,
      kwh: 4,
      waterSpend: 0.2,
      waterKl: 0.05
    });
  });

  it("defaults water domains to the minimum step when omitted", () => {
    expect(buildGlobalDomains(2, 3)).toEqual({ spend: 2, kwh: 3, waterSpend: 0.1, waterKl: 0.05 });
  });
});

describe("roundedCeiling", () => {
  it("rounds up to the next multiple of step", () => {
    expect(roundedCeiling(4.3, 0.5)).toBe(4.5);
    expect(roundedCeiling(4.0, 0.5)).toBe(4);
  });

  it("never returns less than one step, even for 0 or negative input", () => {
    expect(roundedCeiling(0, 0.5)).toBe(0.5);
    expect(roundedCeiling(-3, 0.5)).toBe(0.5);
  });
});
