import { describe, expect, it } from "vitest";
import { buildDemoDataset } from "./dataset";

const START_DATE = "2026-06-01";
const DAYS = 70;

describe("buildDemoDataset", () => {
  it("is deterministic for a given range length", () => {
    const first = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const second = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    expect(second.energyRows).toEqual(first.energyRows);
    expect(second.activities).toEqual(first.activities);
    expect(second.meta).toEqual(first.meta);
  });

  it("produces one fixed daily charge and 48 energy intervals per day", () => {
    const { energyRows } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const fixedRows = energyRows.filter((row) => row.chargeLabel === "Basic Charge");
    const energyOnlyRows = energyRows.filter((row) => row.chargeLabel.startsWith("Energy Charge:"));
    expect(fixedRows).toHaveLength(DAYS);
    expect(energyOnlyRows).toHaveLength(DAYS * 48);
  });

  it("includes at least one top-up, one refund, and water usage", () => {
    const { energyRows, meta } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const topups = energyRows.filter((row) => row.chargeLabel === "Top Up");
    const refunds = energyRows.filter((row) => row.chargeLabel.toLowerCase().includes("refund"));
    const water = energyRows.filter((row) => row.chargeLabel.startsWith("Water:"));

    expect(topups.length).toBeGreaterThanOrEqual(3);
    expect(refunds).toHaveLength(1);
    expect(water.length).toBeGreaterThan(DAYS); // more than one water event/day on average
    expect(meta.topupDates.length).toBe(topups.length);
    expect(meta.refundDate).toBeTruthy();
  });

  it("represents a tariff/rate change as a real change in per-row tariff", () => {
    const { energyRows, meta } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const energyOnlyRows = energyRows.filter((row) => row.chargeLabel.startsWith("Energy Charge:"));
    const beforeChange = energyOnlyRows.filter((row) => row.periodDt.slice(0, 10) < meta.rateChangeDate);
    const afterChange = energyOnlyRows.filter((row) => row.periodDt.slice(0, 10) >= meta.rateChangeDate);
    expect(beforeChange.length).toBeGreaterThan(0);
    expect(afterChange.length).toBeGreaterThan(0);
    // The 50-300 kWh block should carry the representative pre/post rate,
    // so the effective-date change is visible in the raw tariff values.
    const standardBefore = beforeChange.find((row) => Math.abs(row.tariff - meta.baseRateBefore) < 1e-9);
    const standardAfter = afterChange.find((row) => Math.abs(row.tariff - meta.baseRateAfter) < 1e-9);
    expect(standardBefore).toBeDefined();
    expect(standardAfter).toBeDefined();
  });

  it("uses ordered monthly tariff blocks instead of noisy time-of-use rates", () => {
    const { energyRows } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const julyRows = energyRows.filter(
      (row) => row.periodDt.startsWith("2026-07") && row.chargeLabel.startsWith("Energy Charge:")
    );
    const pairs = new Set(julyRows.map((row) => `${row.tariffBand}:${row.tariff}`));

    expect(pairs).toContain("0 - 50:2.3805");
    expect(pairs).toContain("50 - 300:3.0475");
    expect(pairs).toContain("300 - 600:4.301");
    expect(pairs.size).toBeLessThanOrEqual(4);
    expect(julyRows.every((row) => row.chargeLabel === `Energy Charge: ${row.tariffBand}`)).toBe(true);
  });

  it("has at least one obvious short usage spike well above the baseline", () => {
    const { energyRows, meta } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const spikeDayRows = energyRows.filter(
      (row) => row.periodDt.startsWith(meta.spikeDate) && row.chargeLabel.startsWith("Energy Charge:")
    );
    const otherDayRows = energyRows.filter(
      (row) => !row.periodDt.startsWith(meta.spikeDate) && row.chargeLabel.startsWith("Energy Charge:")
    );
    const maxSpikeKwh = Math.max(...spikeDayRows.map((row) => row.kwh));
    const averageOtherKwh = otherDayRows.reduce((sum, row) => sum + row.kwh, 0) / otherDayRows.length;
    expect(maxSpikeKwh).toBeGreaterThan(1.5);
    expect(maxSpikeKwh).toBeGreaterThan(averageOtherKwh * 5);
  });

  it("keeps the running balance within a plausible prepaid range", () => {
    const { energyRows } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    for (const row of energyRows) {
      expect(row.balance).toBeGreaterThan(-200);
      expect(row.balance).toBeLessThan(3000);
    }
    // Balance should actually move over time, not sit flat.
    const balances = new Set(energyRows.map((row) => row.balance));
    expect(balances.size).toBeGreaterThan(energyRows.length / 2);
  });

  it("shows weekday/weekend and month-to-month variation useful for comparisons", () => {
    const { energyRows } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const byMonth = new Map<string, number>();
    for (const row of energyRows) {
      if (!row.chargeLabel.startsWith("Energy Charge:")) continue;
      const month = row.periodDt.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + row.kwh);
    }
    expect(byMonth.size).toBeGreaterThanOrEqual(2);
    const totals = Array.from(byMonth.values());
    expect(Math.max(...totals)).not.toBeCloseTo(Math.min(...totals), 0);
  });

  it("seeds all the required activity tags with valid half-hour-aligned ranges", () => {
    const { activities } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const allTags = new Set(activities.flatMap((activity) => activity.tags));
    for (const tag of [
      "geyser",
      "kettle",
      "laundry",
      "oven",
      "cooking",
      "dishwasher",
      "heater",
      "guests",
      "entertainment",
      "away",
      "investigating"
    ]) {
      expect(allTags.has(tag)).toBe(true);
    }

    for (const activity of activities) {
      const start = new Date(activity.startsAt.replace("T", " ") + "Z");
      const end = new Date(activity.endsAt.replace("T", " ") + "Z");
      expect(start.getUTCMinutes() % 30).toBe(0);
      expect(start.getUTCSeconds()).toBe(0);
      expect(end.getUTCMinutes() % 30).toBe(0);
      expect(end.getUTCSeconds()).toBe(0);
      expect(end.getTime() - start.getTime()).toBeGreaterThan(0);
      expect(end.getTime() - start.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
      if (activity.allDay) {
        expect(activity.startsAt.slice(11)).toBe("00:00:00");
        expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
      }
    }
  });

  it("aligns named household stories with elevated electricity or water intervals", () => {
    const { energyRows, activities, meta } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const usageDuring = (start: string, end: string) =>
      energyRows
        .filter((row) => {
          const timestamp = row.periodDt.replace(" ", "T") + ":00";
          return timestamp >= start && timestamp < end;
        })
        .reduce((sum, row) => sum + row.kwh + row.waterKl * 10, 0);

    for (const tag of ["laundry", "heater", "guests"]) {
      const matching = activities.filter((activity) => activity.tags.includes(tag));
      expect(matching.length).toBeGreaterThan(0);
      expect(matching.every((activity) => usageDuring(activity.startsAt, activity.endsAt) > 0)).toBe(true);
    }

    const investigating = activities.find((activity) => activity.tags.includes("investigating"));
    expect(investigating?.startsAt.startsWith(meta.spikeDate)).toBe(true);
    expect(investigating ? usageDuring(investigating.startsAt, investigating.endsAt) : 0).toBeGreaterThan(4);
  });

  it("includes meaningful cross-midnight guest and entertainment activities", () => {
    const { activities } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const overnight = activities.filter(
      (activity) => !activity.allDay && activity.startsAt.slice(0, 10) !== activity.endsAt.slice(0, 10)
    );
    expect(overnight.some((activity) => activity.tags.includes("guests"))).toBe(true);
    expect(overnight.some((activity) => activity.tags.includes("entertainment"))).toBe(true);
  });

  it("explains the latest day detail's morning and evening peaks", () => {
    const { activities, meta } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const latest = activities.filter((activity) => activity.startsAt.startsWith(meta.endDate));

    expect(latest.some((activity) => activity.tags.includes("geyser") && activity.tags.includes("kettle"))).toBe(true);
    expect(
      latest.some((activity) => activity.tags.includes("cooking") && activity.tags.includes("entertainment"))
    ).toBe(true);
  });

  it("shows a real usage dip during the away stretch, not a flat line", () => {
    const { energyRows, meta } = buildDemoDataset({ startDate: START_DATE, days: DAYS });
    const awayKwhByDate = new Map<string, number>();
    for (const row of energyRows) {
      if (!row.chargeLabel.startsWith("Energy Charge:")) continue;
      const date = row.periodDt.slice(0, 10);
      if (date >= meta.awayStartDate && date < meta.endDate) {
        awayKwhByDate.set(date, (awayKwhByDate.get(date) ?? 0) + row.kwh);
      }
    }
    const awayDayTotal = awayKwhByDate.get(meta.awayStartDate);
    const normalDayTotals = energyRows
      .filter((row) => row.chargeLabel.startsWith("Energy Charge:") && row.periodDt.slice(0, 10) < meta.awayStartDate)
      .reduce((byDate, row) => {
        const date = row.periodDt.slice(0, 10);
        byDate.set(date, (byDate.get(date) ?? 0) + row.kwh);
        return byDate;
      }, new Map<string, number>());
    const averageNormalDay =
      Array.from(normalDayTotals.values()).reduce((sum, value) => sum + value, 0) / normalDayTotals.size;

    expect(awayDayTotal).toBeDefined();
    expect(awayDayTotal ?? 0).toBeLessThan(averageNormalDay * 0.5);
  });

  it("rejects a range that is too short to be a meaningful demo", () => {
    expect(() => buildDemoDataset({ startDate: START_DATE, days: 5 })).toThrow();
  });
});
