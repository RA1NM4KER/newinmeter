import { describe, expect, it } from "vitest";
import { demoCapability, demoCapabilityBlocked } from "./capabilities";

describe("demo capabilities", () => {
  it("keeps safe demo-local interactions available", () => {
    expect(demoCapability("activityMutation").allowed).toBe(true);
    expect(demoCapability("notificationMutation").allowed).toBe(true);
    expect(demoCapability("assistant").allowed).toBe(true);
    expect(demoCapability("export").allowed).toBe(true);
  });

  it("blocks external, destructive, and hardware-only operations only for demos", () => {
    for (const capability of [
      "sync",
      "connectionMutation",
      "accountDeletion",
      "alertMutation",
      "pushSubscription",
      "liveMeter"
    ] as const) {
      expect(demoCapabilityBlocked(true, capability)).toBe(true);
      expect(demoCapabilityBlocked(false, capability)).toBe(false);
      expect(demoCapability(capability).reason).toBeTruthy();
    }
  });
});
