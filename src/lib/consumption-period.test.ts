import { describe, expect, it } from "vitest";
import { consumptionPeriodLabel, intervalTimeLabel } from "./consumption-period";

describe("SAST consumption periods", () => {
  it("formats half-hour starts without changing their stored value", () => {
    expect(consumptionPeriodLabel("2026-10-13T12:30")).toEqual({
      label: "13 Oct · 12:30–13:00",
      accessibleLabel: "13 Oct 2026 12:30–13:00 SAST"
    });
    expect(intervalTimeLabel("04:00", 30)).toBe("04:00–04:30");
  });
  it("makes midnight and year boundaries unambiguous", () => {
    expect(intervalTimeLabel("23:30", 30)).toBe("23:30–24:00");
    expect(consumptionPeriodLabel("2026-12-31 23:30:00")).toEqual({
      label: "31 Dec · 23:30–1 Jan 00:00",
      accessibleLabel: "31 Dec 2026 23:30–1 Jan 2027 00:00 SAST"
    });
  });
  it("uses the actual hourly resolution", () => {
    expect(intervalTimeLabel("04:00", 60)).toBe("04:00–05:00");
    expect(intervalTimeLabel(23, 60)).toBe("23:00–24:00");
  });
  it("converts explicit UTC timestamps to SAST but treats naive periods as SAST", () => {
    expect(consumptionPeriodLabel("2026-10-13T10:30:00Z").label).toBe("13 Oct · 12:30–13:00");
    expect(consumptionPeriodLabel("2026-10-13T12:30:00+02:00").label).toBe("13 Oct · 12:30–13:00");
  });
  it("does not turn transactions into half-hour consumption", () => {
    expect(consumptionPeriodLabel("2026-10-13T12:30", 0).label).toBe("13 Oct · 12:30");
  });
  it("preserves invalid labels rather than inventing a time", () => {
    expect(consumptionPeriodLabel("unknown").label).toBe("unknown");
    expect(consumptionPeriodLabel("2026-02-30T12:30").label).toBe("2026-02-30T12:30");
  });
});
