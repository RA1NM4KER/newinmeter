import { describe, expect, it } from "vitest";
import {
  activityDurationMinutes,
  activityIncludesInterval,
  activityOverlayRange,
  activityRangeValidationError,
  activityTimeLabel,
  aggregateActivityReportRow,
  averageDemandKw,
  buildActivityRange,
  deduplicatedActivitySummary,
  displayActivityTag,
  isHalfHourTime,
  normalizeActivityTags,
  validateActivityInput
} from "./utils";
import type { UsageActivity } from "../types";

describe("activity tags", () => {
  it("normalizes, trims, and deduplicates tags case-insensitively", () => {
    expect(normalizeActivityTags([" Geyser ", "geyser", "Cold   Evening"])).toEqual(["geyser", "cold evening"]);
    expect(displayActivityTag("cold evening")).toBe("Cold Evening");
  });
});

describe("activity ranges and validation", () => {
  it("builds a half-open whole-day range", () => {
    expect(buildActivityRange({ date: "2026-08-04", allDay: true })).toEqual({
      startsAt: "2026-08-04T00:00:00",
      endsAt: "2026-08-05T00:00:00"
    });
  });

  it("builds a same-day timed range", () => {
    expect(
      buildActivityRange({
        date: "2026-08-16",
        allDay: false,
        startTime: "22:00",
        endTime: "23:30"
      })
    ).toEqual({
      startsAt: "2026-08-16T22:00:00",
      endsAt: "2026-08-16T23:30:00"
    });
  });

  it("builds a cross-midnight timed range", () => {
    expect(
      buildActivityRange({
        date: "2026-08-16",
        allDay: false,
        startTime: "22:00",
        endTime: "05:00"
      })
    ).toEqual({
      startsAt: "2026-08-16T22:00:00",
      endsAt: "2026-08-17T05:00:00"
    });
  });

  it("treats equal clock times as exactly 24 hours", () => {
    const range = buildActivityRange({
      date: "2026-08-16",
      allDay: false,
      startTime: "22:00",
      endTime: "22:00"
    });

    expect(range).toEqual({
      startsAt: "2026-08-16T22:00:00",
      endsAt: "2026-08-17T22:00:00"
    });
    expect(activityDurationMinutes(range.startsAt, range.endsAt)).toBe(24 * 60);
  });

  it("accepts only 30-minute time increments", () => {
    expect(isHalfHourTime("18:00")).toBe(true);
    expect(isHalfHourTime("18:30")).toBe(true);
    expect(isHalfHourTime("18:15")).toBe(false);
  });

  it("accepts valid cross-midnight and exactly-24-hour activities", () => {
    expect(
      validateActivityInput({
        date: "2026-08-16",
        allDay: false,
        startTime: "22:00",
        endTime: "05:00",
        tags: ["away"]
      }).success
    ).toBe(true);
    expect(
      validateActivityInput({
        date: "2026-08-16",
        allDay: false,
        startTime: "22:00",
        endTime: "22:00",
        tags: ["heater"]
      }).success
    ).toBe(true);
  });

  it("rejects timed timestamp ranges longer than 24 hours", () => {
    expect(activityRangeValidationError("2026-08-16T22:00:00", "2026-08-17T22:30:00", false)).toBe(
      "Timed activities cannot be longer than 24 hours."
    );
  });

  it("requires tags and validates tag and note limits", () => {
    expect(validateActivityInput({ date: "2026-08-04", allDay: true, tags: [] }).success).toBe(false);
    expect(validateActivityInput({ date: "2026-08-04", allDay: true, tags: ["x".repeat(31)] }).success).toBe(false);
    expect(
      validateActivityInput({ date: "2026-08-04", allDay: true, tags: ["home"], note: "x".repeat(501) }).success
    ).toBe(false);
  });

  it("defaults and validates persisted activity colours", () => {
    const defaulted = validateActivityInput({ date: "2026-08-04", allDay: true, tags: ["home"] });
    expect(defaulted.success && defaulted.value.color).toBe("#0f766e");
    expect(
      validateActivityInput({ date: "2026-08-04", allDay: true, tags: ["home"], color: "not-a-colour" }).success
    ).toBe(false);
    const normalized = validateActivityInput({ date: "2026-08-04", allDay: true, tags: ["home"], color: "#2563EB" });
    expect(normalized.success && normalized.value.color).toBe("#2563eb");
  });
});

describe("activity time labels", () => {
  it("shows same-day times without a suffix", () => {
    expect(
      activityTimeLabel({
        startsAt: "2026-08-16T18:00:00",
        endsAt: "2026-08-16T20:30:00",
        allDay: false
      })
    ).toBe("18:00 to 20:30");
  });

  it("marks cross-midnight times using the actual end date", () => {
    expect(
      activityTimeLabel({
        startsAt: "2026-08-16T22:00:00",
        endsAt: "2026-08-17T05:00:00",
        allDay: false
      })
    ).toBe("22:00 to 05:00 next day");
  });

  it("keeps the whole-day label unchanged", () => {
    expect(
      activityTimeLabel({
        startsAt: "2026-08-16T00:00:00",
        endsAt: "2026-08-17T00:00:00",
        allDay: true
      })
    ).toBe("Whole day");
  });
});

describe("activity usage calculations", () => {
  it("includes the start interval and excludes the end boundary", () => {
    const start = "2026-08-04T18:00:00";
    const end = "2026-08-04T20:30:00";
    expect(activityIncludesInterval(start, end, "2026-08-04", "18:00")).toBe(true);
    expect(activityIncludesInterval(start, end, "2026-08-04", "20:00")).toBe(true);
    expect(activityIncludesInterval(start, end, "2026-08-04", "20:30")).toBe(false);
    expect(activityDurationMinutes(start, end)).toBe(150);
  });

  it("maps timed and whole-day activities to chart categories", () => {
    expect(
      activityOverlayRange(
        { startsAt: "2026-08-04T18:00:00", endsAt: "2026-08-04T20:30:00", allDay: false },
        "2026-08-04"
      )
    ).toEqual({ startTime: "18:00", endTime: "20:30" });
    expect(
      activityOverlayRange(
        { startsAt: "2026-08-04T00:00:00", endsAt: "2026-08-05T00:00:00", allDay: true },
        "2026-08-04"
      )
    ).toEqual({ startTime: "00:00", endTime: "23:30" });
  });

  it("clips a cross-midnight activity to each day it overlaps", () => {
    const activity = {
      startsAt: "2026-08-16T22:00:00",
      endsAt: "2026-08-17T05:00:00",
      allDay: false
    };

    expect(activityOverlayRange(activity, "2026-08-16")).toEqual({ startTime: "22:00", endTime: "23:30" });
    expect(activityOverlayRange(activity, "2026-08-17")).toEqual({ startTime: "00:00", endTime: "05:00" });
  });

  it("calculates average demand from kWh over duration hours", () => {
    expect(averageDemandKw(1.5, 30)).toBe(3);
    expect(averageDemandKw(5, 150)).toBe(2);
  });

  it("aggregates one report row from matching interval rollups", () => {
    const activity: UsageActivity = {
      id: "a",
      startsAt: "2026-08-04T18:00:00",
      endsAt: "2026-08-04T19:00:00",
      allDay: false,
      tags: ["geyser"],
      color: "#0f766e",
      createdAt: "",
      updatedAt: ""
    };
    const intervals = ["17:30", "18:00", "18:30", "19:00"].map((periodTime) => ({
      periodDate: "2026-08-04",
      periodTime,
      kwh: 1,
      spend: 2,
      waterKl: 0.1,
      waterSpend: 0.5
    }));
    expect(aggregateActivityReportRow(activity, intervals)).toMatchObject({
      durationMinutes: 60,
      electricityKwh: 2,
      averageKw: 2,
      electricitySpend: 4,
      waterKl: 0.2,
      waterSpend: 1
    });
  });

  it("deduplicates overlapping slots in aggregate summaries", () => {
    const base = { allDay: false, tags: ["heater"], color: "#0f766e", createdAt: "", updatedAt: "" };
    const activities: UsageActivity[] = [
      { ...base, id: "a", startsAt: "2026-08-04T18:00:00", endsAt: "2026-08-04T19:00:00" },
      { ...base, id: "b", startsAt: "2026-08-04T18:30:00", endsAt: "2026-08-04T19:30:00" }
    ];
    const intervals = ["18:00", "18:30", "19:00"].map((periodTime) => ({
      periodDate: "2026-08-04",
      periodTime,
      kwh: 1,
      spend: 2,
      waterKl: 0.1,
      waterSpend: 0.5
    }));
    expect(deduplicatedActivitySummary(activities, intervals)).toEqual({
      taggedDurationMinutes: 90,
      electricityKwh: 3,
      electricitySpend: 6,
      waterKl: 0.30000000000000004,
      waterSpend: 1.5
    });
  });
});
