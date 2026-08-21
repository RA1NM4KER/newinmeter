import { describe, expect, it } from "vitest";
import { LIVE_FALLBACK_POLL_MS, liveMeterTopic, PULSES_CHANGED_EVENT } from "@/lib/live/realtime";

describe("live realtime constants", () => {
  it("derives a per-user private topic from the user id", () => {
    expect(liveMeterTopic("user-a")).toBe("live-meter:user-a");
    expect(liveMeterTopic("user-b")).toBe("live-meter:user-b");
    // Server broadcast and client subscribe agree on the same topic for a user.
    expect(liveMeterTopic("user-a")).not.toBe(liveMeterTopic("user-b"));
  });

  it("names the invalidation event", () => {
    expect(PULSES_CHANGED_EVENT).toBe("pulses_changed");
  });

  it("keeps a slow fallback poll (not the old ~5s cadence)", () => {
    expect(LIVE_FALLBACK_POLL_MS).toBe(60_000);
  });
});
