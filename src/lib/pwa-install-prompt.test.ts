// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissInstallPromo, isInstallPromoCoolingDown } from "./pwa-install-prompt";

describe("pwa-install-prompt", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is not cooling down by default", () => {
    expect(isInstallPromoCoolingDown()).toBe(false);
  });

  it("cools down immediately after a dismissal", () => {
    dismissInstallPromo();
    expect(isInstallPromoCoolingDown()).toBe(true);
  });

  it("stops cooling down once the cooldown window has passed -- a timestamp, not a forever flag", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    dismissInstallPromo();
    expect(isInstallPromoCoolingDown()).toBe(true);

    vi.spyOn(Date, "now").mockReturnValue(now + 8 * 24 * 60 * 60 * 1000);
    expect(isInstallPromoCoolingDown()).toBe(false);
  });
});
