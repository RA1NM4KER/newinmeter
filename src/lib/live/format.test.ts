import { describe, expect, it } from "vitest";
import { formatLiveKwh, formatMinuteChange, formatPulseAgo, pulseAgeMs } from "@/lib/live/format";

describe("formatPulseAgo", () => {
  it("reads 'just now' under a second and clamps negatives", () => {
    expect(formatPulseAgo(0)).toBe("just now");
    expect(formatPulseAgo(-5000)).toBe("just now");
  });

  it("uses seconds, minutes, hours and days", () => {
    expect(formatPulseAgo(1000)).toBe("1s ago");
    expect(formatPulseAgo(45_000)).toBe("45s ago");
    expect(formatPulseAgo(90_000)).toBe("1m ago");
    expect(formatPulseAgo(3 * 3_600_000)).toBe("3h ago");
    expect(formatPulseAgo(2 * 24 * 3_600_000)).toBe("2d ago");
  });
});

describe("pulseAgeMs", () => {
  const generatedAt = "2026-08-07T10:30:00.000Z";
  const lastPulseAt = "2026-08-07T10:29:58.000Z"; // 2s before generatedAt
  const generatedMs = Date.parse(generatedAt);

  it("adds local elapsed time when there is a valid data-updated anchor", () => {
    // anchor = generatedMs (data just arrived), 5s later.
    expect(pulseAgeMs(generatedAt, lastPulseAt, generatedMs, generatedMs + 5000)).toBe(7000); // 2s + 5s
  });

  it("does NOT balloon when dataUpdatedAt is 0 (window switch, placeholder data)", () => {
    // Regression: dataUpdatedAt=0 previously gave Date.now()-0 ≈ epoch millis.
    // Now local elapsed is skipped, so age is just the server age (2s).
    expect(pulseAgeMs(generatedAt, lastPulseAt, 0, Date.now())).toBe(2000);
  });

  it("returns null without a pulse or generated time", () => {
    expect(pulseAgeMs(generatedAt, null, generatedMs, generatedMs)).toBeNull();
    expect(pulseAgeMs(null, lastPulseAt, generatedMs, generatedMs)).toBeNull();
  });

  it("never returns negative", () => {
    expect(pulseAgeMs(generatedAt, lastPulseAt, generatedMs + 10_000, generatedMs)).toBeGreaterThanOrEqual(0);
  });
});

describe("formatLiveKwh", () => {
  it("uses a dot decimal and pulse-resolution precision (no false zeros)", () => {
    expect(formatLiveKwh(0.27)).toBe("0.27 kWh");
    expect(formatLiveKwh(2.84)).toBe("2.84 kWh");
    expect(formatLiveKwh(0.004)).toBe("0.004 kWh");
    expect(formatLiveKwh(0)).toBe("0 kWh");
  });
});

describe("formatMinuteChange", () => {
  it("shows a restrained signed absolute change", () => {
    expect(formatMinuteChange(1840)).toBe("↑ 1.84 kW in the last minute");
    expect(formatMinuteChange(-1840)).toBe("↓ 1.84 kW in the last minute");
    expect(formatMinuteChange(320)).toBe("↑ 320 W in the last minute");
  });

  it("omits negligible change and null", () => {
    expect(formatMinuteChange(20)).toBeNull();
    expect(formatMinuteChange(null)).toBeNull();
  });
});
