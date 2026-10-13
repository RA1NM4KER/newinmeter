import { describe, expect, it } from "vitest";
import { observeReporting, parseReportingModel, reconciliationStartDate } from "./adaptive-schedule";
import type { NewinmeterCsvRow } from "./web";

const now = new Date("2026-10-13T10:00:00Z");
function batches(minutes: number, count = 6, kind = "Energy Charge:", offset = 0): NewinmeterCsvRow[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getTime() - ((count - 1 - index) * minutes + offset) * 60000);
    return {
      source_ts: date.toISOString(),
      capture_dt: "",
      period_dt: "2026-10-13 10:00",
      charge_label: kind,
      kwh: "0",
      water_kl: "0",
      tariff: "2.5",
      cost: "0",
      balance: "100"
    };
  });
}

describe("publication scheduling", () => {
  it("learns repeated 106-minute publication at zero consumption", () => {
    const model = observeReporting({}, batches(106), "a", now);
    expect(model.energy.cadenceMinutes).toBe(106);
    expect(model.energy.confidence).toBe(1);
    expect(model.predictedAt).toBe("2026-10-13T11:56:00.000Z");
  });
  it("does not upgrade from one or two matching gaps", () => {
    expect(observeReporting({}, batches(106, 3), "a", now).energy.cadenceMinutes).toBeNull();
  });
  it("uses electricity for scheduling even when water predicts an earlier batch", () => {
    const model = observeReporting({}, [...batches(106), ...batches(71, 6, "Water:", 30)], "a", now);
    expect(model.water.cadenceMinutes).toBe(71);
    expect(model.predictedAt).toBe("2026-10-13T11:56:00.000Z");
    expect(model.reason).toBe("Electricity publication prediction: 106 min");
  });
  it("does not schedule fast polls from water-only cadence", () => {
    const model = observeReporting({}, batches(71, 6, "Water:"), "a", now);
    expect(model.water.cadenceMinutes).toBe(71);
    expect(model.energy.cadenceMinutes).toBeNull();
    expect(model.reason).toContain("fallback");
    expect(model.predictedAt).toBe(observeReporting({}, [], "a", now).predictedAt);
  });
  it("ignores overdue water predictions after collecting an electricity batch", () => {
    const rows = [...batches(106), ...batches(106, 6, "Water:", 130)];
    const model = observeReporting({}, rows, "a", now);
    expect(model.water.cadenceMinutes).toBe(106);
    expect(model.predictedAt).toBe("2026-10-13T11:56:00.000Z");
  });
  it("learns a 71-minute electricity cadence with the same safety floor", () => {
    expect(observeReporting({}, batches(71), "a", now).predictedAt).toBe("2026-10-13T11:21:00.000Z");
  });
  it("combines observations across small incremental responses without duplicating batches", () => {
    let model = observeReporting({}, batches(106, 2, "Energy Charge:", 212), "a", now);
    model = observeReporting(model, batches(106, 2), "a", now);
    expect(model.energy.samples).toHaveLength(4);
    expect(model.energy.cadenceMinutes).toBe(106);
    expect(observeReporting(model, batches(106, 2), "a", now).energy.samples).toHaveLength(4);
  });
  it("detects an upgrade after old batches and ignores backlog size as cadence evidence", () => {
    const old = batches(360, 4, "Energy Charge:", 636).flatMap((row) => Array(12).fill(row));
    const model = observeReporting({}, [...old, ...batches(106, 5)], "a", now);
    expect(model.energy.cadenceMinutes).toBe(106);
  });
  it("returns to fallback after sustained six-hour batches", () => {
    const fast = observeReporting({}, batches(106), "a", now);
    const later = new Date(now.getTime() + 36 * 3600000);
    const slow = batches(360).flatMap((row) =>
      Array(12).fill({ ...row, source_ts: new Date(Date.parse(row.source_ts) + 36 * 3600000).toISOString() })
    );
    const model = observeReporting(fast, slow, "a", later);
    expect(model.energy.cadenceMinutes).toBe(360);
    expect(model.reason).toContain("fallback");
  });
  it("bounds model history and rejects corrupt persisted state", () => {
    expect(observeReporting({}, batches(106, 50), "a", now).energy.samples.length).toBeLessThanOrEqual(12);
    expect(parseReportingModel({ version: 1, energy: { samples: "bad" } }).energy.samples).toEqual([]);
  });
  it("ignores future and old publication timestamps", () => {
    const rows = batches(106).map((row) => ({ ...row, source_ts: "2027-01-01T00:00:00Z" }));
    expect(observeReporting({}, rows, "a", now).latestPublicationAt).toBeNull();
  });
  it("backs off a missed electricity prediction even when water keeps arriving", () => {
    let model = observeReporting({}, batches(106), "a", now);
    const later = new Date(now.getTime() + 150 * 60000);
    model = observeReporting(
      model,
      batches(71, 1, "Water:").map((row) => ({ ...row, source_ts: later.toISOString() })),
      "a",
      later
    );
    expect(model.energy.emptyStreak).toBe(1);
    expect(Date.parse(model.predictedAt!) - later.getTime()).toBe(60 * 60000);
    model = observeReporting(model, [], "a", later);
    expect(Date.parse(model.predictedAt!) - later.getTime()).toBe(120 * 60000);
  });
  it("does not filter publication observations by kWh amount", () => {
    const high = batches(106).map((row) => ({ ...row, kwh: "50" }));
    expect(observeReporting({}, high, "a", now).predictedAt).toEqual(
      observeReporting({}, batches(106), "a", now).predictedAt
    );
  });
  it("reconciles historical periods daily with a 90-day lookback", () => {
    expect(reconciliationStartDate(null, now)).toBe("2026-07-15");
    expect(reconciliationStartDate("2026-10-13T01:00:00Z", now)).toBeNull();
    expect(reconciliationStartDate("bad", now)).toBe("2026-07-15");
  });
});
