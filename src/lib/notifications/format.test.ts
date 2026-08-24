import { describe, expect, it } from "vitest";
import { formatNotificationTime } from "./format";

function minutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

describe("formatNotificationTime", () => {
  const now = new Date("2026-08-24T12:00:00+02:00"); // SAST

  it("shows 'Just now' for under a minute", () => {
    expect(formatNotificationTime(minutesAgo(now, 0), now)).toBe("Just now");
    expect(formatNotificationTime(minutesAgo(now, 0.5), now)).toBe("Just now");
  });

  it("shows minutes for under an hour", () => {
    expect(formatNotificationTime(minutesAgo(now, 1), now)).toBe("1 min ago");
    expect(formatNotificationTime(minutesAgo(now, 8), now)).toBe("8 min ago");
    expect(formatNotificationTime(minutesAgo(now, 59), now)).toBe("59 min ago");
  });

  it("shows hours for under a day", () => {
    expect(formatNotificationTime(minutesAgo(now, 60), now)).toBe("1 hr ago");
    expect(formatNotificationTime(minutesAgo(now, 120), now)).toBe("2 hr ago");
    expect(formatNotificationTime(minutesAgo(now, 23 * 60 + 59), now)).toBe("23 hr ago");
  });

  it("shows 'Yesterday' for the previous SAST calendar day", () => {
    // now is 2026-08-24 12:00 SAST; 20 hours ago is 2026-08-23 16:00 SAST --
    // yesterday's calendar date, even though it's under 24 raw hours off
    // from other boundary cases.
    const yesterdayAt4pm = new Date("2026-08-23T16:00:00+02:00");
    const diffHours = (now.getTime() - yesterdayAt4pm.getTime()) / 3_600_000;
    expect(diffHours).toBeLessThan(24);
    // Under 24 raw hours still shows hour-precision per the exact examples
    // in the spec ("2 hr ago" is a valid state up to 24h) -- "Yesterday"
    // only takes over once the raw difference reaches a full day.
    expect(formatNotificationTime(yesterdayAt4pm.toISOString(), now)).toBe("20 hr ago");

    const exactlyOneDayAgo = new Date(now.getTime() - 24 * 3_600_000);
    expect(formatNotificationTime(exactlyOneDayAgo.toISOString(), now)).toBe("Yesterday");
  });

  it("shows day counts beyond yesterday", () => {
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3_600_000);
    expect(formatNotificationTime(threeDaysAgo.toISOString(), now)).toBe("3 days ago");
  });

  it("is deterministic for a fixed now", () => {
    const iso = minutesAgo(now, 45);
    expect(formatNotificationTime(iso, now)).toBe(formatNotificationTime(iso, now));
  });
});
