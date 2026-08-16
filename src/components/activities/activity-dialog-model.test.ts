import { describe, expect, it } from "vitest";
import {
  activityColorAfterAddingTag,
  activityDialogInitialForm,
  activityEndTimeOptions,
  activityTagSuggestions,
  activityToday,
  defaultActivityEndTime,
  halfHourTimes,
  resolveAddTag
} from "./activity-dialog-model";

describe("activity colour suggestions", () => {
  it("uses the recent colour when the first tag is added", () => {
    expect(activityColorAfterAddingTag([], ["geyser"], "#0f766e", { geyser: "#2563eb" })).toBe("#2563eb");
  });

  it("does not replace a chosen colour when another tag is added", () => {
    expect(activityColorAfterAddingTag(["geyser"], ["geyser", "winter"], "#db2777", { winter: "#65a30d" })).toBe(
      "#db2777"
    );
  });
});

describe("activity dialog model", () => {
  it("provides all 48 start slots in half-hour steps", () => {
    expect(halfHourTimes).toHaveLength(48);
    expect(halfHourTimes.slice(0, 3)).toEqual(["00:00", "00:30", "01:00"]);
    expect(halfHourTimes.at(-1)).toBe("23:30");
  });

  it("offers the next 48 chronological boundaries after a late start", () => {
    const options = activityEndTimeOptions("22:00");

    expect(options).toHaveLength(48);
    expect(options[0]).toEqual({ value: "22:30", label: "22:30" });
    expect(options.find((option) => option.value === "23:30")).toEqual({ value: "23:30", label: "23:30" });
    expect(options.find((option) => option.value === "00:00")).toEqual({
      value: "00:00",
      label: "00:00 next day"
    });
    expect(options.find((option) => option.value === "05:00")).toEqual({
      value: "05:00",
      label: "05:00 next day"
    });
    expect(options.at(-1)).toEqual({ value: "22:00", label: "22:00 next day" });
    expect(options.every((option) => !("disabled" in option))).toBe(true);
  });

  it("rolls an early start over only after midnight", () => {
    const options = activityEndTimeOptions("05:30");

    expect(options[0]).toEqual({ value: "06:00", label: "06:00" });
    expect(options.find((option) => option.value === "23:30")?.label).toBe("23:30");
    expect(options.find((option) => option.value === "00:00")?.label).toBe("00:00 next day");
    expect(options.at(-1)).toEqual({ value: "05:30", label: "05:30 next day" });
  });

  it("offers existing tags case-insensitively without already selected tags", () => {
    expect(activityTagSuggestions(["Geyser", "heater", "guests"], ["geyser"], "he")).toEqual(["heater"]);
  });

  it("uses today's Johannesburg date for a new activity", () => {
    expect(activityToday(new Date("2026-08-03T22:30:00Z"))).toBe("2026-08-04");
  });

  it("defaults a focused activity to two hours with natural midnight wrapping", () => {
    expect(defaultActivityEndTime("17:30")).toBe("19:30");
    expect(defaultActivityEndTime("22:00")).toBe("00:00");
    expect(defaultActivityEndTime("22:30")).toBe("00:30");
    expect(defaultActivityEndTime("23:30")).toBe("01:30");
  });

  it("loads an existing cross-midnight activity without losing its end clock time", () => {
    expect(
      activityDialogInitialForm({
        id: "activity-a",
        startsAt: "2026-08-16T22:00:00",
        endsAt: "2026-08-17T05:00:00",
        allDay: false,
        tags: ["heater"],
        color: "#0f766e",
        createdAt: "",
        updatedAt: ""
      })
    ).toMatchObject({
      date: "2026-08-16",
      startTime: "22:00",
      endTime: "05:00"
    });
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
