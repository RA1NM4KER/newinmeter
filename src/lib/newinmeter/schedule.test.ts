import { describe, expect, it } from "vitest";
import {
  AUTO_SYNC_DEFAULT_WINDOWS_MINUTES,
  AUTO_SYNC_JITTER_MINUTES,
  computeAutoSyncRetryAt,
  computeNextAutoSyncAt,
  connectionOffsetMinutes
} from "./schedule";

// Africa/Johannesburg is a fixed UTC+2, no DST -- these UTC offsets are
// exact and stable for every test below.
function saTime(isoLocal: string): Date {
  return new Date(`${isoLocal}+02:00`);
}

describe("connectionOffsetMinutes", () => {
  it("is deterministic for the same connection id", () => {
    const a = connectionOffsetMinutes("11111111-1111-1111-1111-111111111111");
    const b = connectionOffsetMinutes("11111111-1111-1111-1111-111111111111");
    expect(a).toBe(b);
  });

  it("stays within the allowed jitter range", () => {
    const ids = ["a", "b", "connection-1", "11111111-1111-1111-1111-111111111111", ""];
    for (const id of ids) {
      const offset = connectionOffsetMinutes(id);
      expect(offset).toBeGreaterThanOrEqual(-AUTO_SYNC_JITTER_MINUTES);
      expect(offset).toBeLessThanOrEqual(AUTO_SYNC_JITTER_MINUTES);
    }
  });

  it("distributes different connections across different offsets", () => {
    const offsets = new Set(
      ["conn-a", "conn-b", "conn-c", "conn-d", "conn-e"].map((id) => connectionOffsetMinutes(id))
    );
    // Not a strict uniqueness guarantee (pigeonhole allows collisions), but
    // five distinct ids collapsing to one offset would indicate the hash is
    // broken, not just unlucky.
    expect(offsets.size).toBeGreaterThan(1);
  });
});

describe("computeNextAutoSyncAt", () => {
  const connectionId = "22222222-2222-2222-2222-222222222222";
  const offset = connectionOffsetMinutes(connectionId);

  it("picks today's next window when one is still ahead", () => {
    const now = saTime("2026-08-24T04:00:00");
    const next = computeNextAutoSyncAt(connectionId, now);

    expect(next.getTime()).toBeGreaterThan(now.getTime());
    // Should land on today's 05:15 window (plus this connection's offset).
    const expected = saTime("2026-08-24T05:15:00");
    expected.setTime(expected.getTime() + offset * 60_000);
    expect(next.getTime()).toBe(expected.getTime());
  });

  it("rolls over to tomorrow's first window after the last window has passed", () => {
    const now = saTime("2026-08-24T23:40:00");
    const next = computeNextAutoSyncAt(connectionId, now);

    const expected = saTime("2026-08-25T05:15:00");
    expected.setTime(expected.getTime() + offset * 60_000);
    expect(next.getTime()).toBe(expected.getTime());
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("is always strictly in the future relative to now, at every window boundary", () => {
    const boundaries = [
      "2026-08-24T05:15:00",
      "2026-08-24T12:15:00",
      "2026-08-24T18:15:00",
      "2026-08-24T23:15:00",
      "2026-08-24T00:00:00",
      "2026-08-24T23:59:00"
    ];

    for (const boundary of boundaries) {
      const now = saTime(boundary);
      const next = computeNextAutoSyncAt(connectionId, now);
      expect(next.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("is deterministic and stable for the same connection and instant", () => {
    const now = saTime("2026-08-24T09:00:00");
    const first = computeNextAutoSyncAt(connectionId, now);
    const second = computeNextAutoSyncAt(connectionId, now);
    expect(first.getTime()).toBe(second.getTime());
  });

  it("distributes different connections' exact times within a window", () => {
    const now = saTime("2026-08-24T04:00:00");
    const times = new Set(
      ["conn-a", "conn-b", "conn-c", "conn-d"].map((id) => computeNextAutoSyncAt(id, now).getTime())
    );
    expect(times.size).toBeGreaterThan(1);
  });

  it("never schedules outside the jittered window range", () => {
    const now = saTime("2026-08-24T00:00:00");
    const next = computeNextAutoSyncAt(connectionId, now);
    const minutesFromMidnight = (next.getTime() - saTime("2026-08-24T00:00:00").getTime()) / 60_000;

    const nearestWindow = AUTO_SYNC_DEFAULT_WINDOWS_MINUTES.reduce((closest, windowMinutes) =>
      Math.abs(windowMinutes - minutesFromMidnight) < Math.abs(closest - minutesFromMidnight) ? windowMinutes : closest
    );

    expect(Math.abs(minutesFromMidnight - nearestWindow)).toBeLessThanOrEqual(AUTO_SYNC_JITTER_MINUTES);
  });

  it("supports a custom window list without changing the contract", () => {
    const now = saTime("2026-08-24T00:00:00");
    const next = computeNextAutoSyncAt(connectionId, now, { windowsMinutes: [6 * 60] });
    const expectedBase = saTime("2026-08-24T06:00:00");
    expect(Math.abs(next.getTime() - expectedBase.getTime())).toBeLessThanOrEqual(AUTO_SYNC_JITTER_MINUTES * 60_000);
  });
});

describe("computeAutoSyncRetryAt", () => {
  it("returns a modest fixed backoff, not an aggressive immediate retry", () => {
    const now = new Date("2026-08-24T04:00:00.000Z");
    const retryAt = computeAutoSyncRetryAt(now);
    const minutes = (retryAt.getTime() - now.getTime()) / 60_000;

    expect(minutes).toBeGreaterThan(5);
    expect(minutes).toBeLessThanOrEqual(60);
  });
});
