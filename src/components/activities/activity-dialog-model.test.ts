import { describe, expect, it } from "vitest";
import {
  activityTagSuggestions,
  activityToday,
  defaultActivityEndTime,
  halfHourTimes,
  resolveAddTag
} from "./activity-dialog-model";

describe("activity dialog model", () => {
  it("provides all 48 start slots in half-hour steps", () => {
    expect(halfHourTimes).toHaveLength(48);
    expect(halfHourTimes.slice(0, 3)).toEqual(["00:00", "00:30", "01:00"]);
    expect(halfHourTimes.at(-1)).toBe("23:30");
  });

  it("offers existing tags case-insensitively without already selected tags", () => {
    expect(activityTagSuggestions(["Geyser", "heater", "guests"], ["geyser"], "he")).toEqual(["heater"]);
  });

  it("uses today's Johannesburg date for a new activity", () => {
    expect(activityToday(new Date("2026-08-03T22:30:00Z"))).toBe("2026-08-04");
  });

  it("defaults a focused activity to two hours and caps it at midnight", () => {
    expect(defaultActivityEndTime("17:30")).toBe("19:30");
    expect(defaultActivityEndTime("22:00")).toBe("00:00");
    expect(defaultActivityEndTime("23:30")).toBe("00:00");
  });
});

describe("resolveAddTag", () => {
  it("adds a genuinely new tag, normalized to lowercase", () => {
    expect(resolveAddTag(["geyser"], "  Cold Evening  ", 10)).toEqual({
      status: "added",
      tags: ["geyser", "cold evening"]
    });
  });

  it("reports a case-insensitive duplicate instead of adding a second chip", () => {
    expect(resolveAddTag(["geyser"], "GEYSER", 10)).toEqual({ status: "duplicate" });
  });

  it("does not let a duplicate's rejected text quietly become part of the next tag", () => {
    // Regression for the bug where the input kept the rejected "GEYSER" text,
    // so typing "tag2" afterwards produced the input value "GEYSERtag2" --
    // which resolveAddTag must treat as one brand-new tag, not a duplicate,
    // proving the concatenation is a real (if different) tag rather than the
    // original duplicate silently slipping through under a new name.
    const duplicateAttempt = resolveAddTag(["geyser"], "GEYSER", 10);
    expect(duplicateAttempt.status).toBe("duplicate");

    const concatenatedIfInputWereNotCleared = resolveAddTag(["geyser"], "GEYSERtag2", 10);
    expect(concatenatedIfInputWereNotCleared).toEqual({
      status: "added",
      tags: ["geyser", "geysertag2"]
    });
  });

  it("ignores an empty or whitespace-only value without touching existing tags", () => {
    expect(resolveAddTag(["geyser"], "   ", 10)).toEqual({ status: "empty" });
  });

  it("reports the limit once the maximum tag count is reached", () => {
    const tenTags = Array.from({ length: 10 }, (_, index) => `tag${index}`);
    expect(resolveAddTag(tenTags, "eleventh", 10)).toEqual({ status: "limit" });
  });

  it("still reports duplicate ahead of limit when both would apply", () => {
    const tenTags = Array.from({ length: 10 }, (_, index) => `tag${index}`);
    expect(resolveAddTag(tenTags, "tag0", 10)).toEqual({ status: "duplicate" });
  });
});
