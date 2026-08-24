// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPushPermissionState: vi.fn(),
  ensurePushNotificationsEnabled: vi.fn(),
  hasActiveSubscription: vi.fn(),
  unsubscribeFromPush: vi.fn()
}));

vi.mock("@/lib/push-client", () => ({
  getPushPermissionState: mocks.getPushPermissionState,
  ensurePushNotificationsEnabled: mocks.ensurePushNotificationsEnabled,
  hasActiveSubscription: mocks.hasActiveSubscription,
  unsubscribeFromPush: mocks.unsubscribeFromPush
}));

import { BadgePermissionCard } from "./badge-permission-card";

describe("BadgePermissionCard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasActiveSubscription.mockResolvedValue(false);
  });

  it("renders nothing when the platform is unsupported -- via the same shared capability check Alerts uses", () => {
    mocks.getPushPermissionState.mockReturnValue("unsupported");
    const { container } = render(<BadgePermissionCard />);
    expect(container.firstChild).toBeNull();
  });

  it("reflects an already-active subscription as on", async () => {
    mocks.getPushPermissionState.mockReturnValue("granted");
    mocks.hasActiveSubscription.mockResolvedValue(true);
    render(<BadgePermissionCard />);

    await waitFor(() => expect(screen.getByLabelText("Notifications").getAttribute("aria-checked")).toBe("true"));
  });

  it("disables the toggle and explains when permission is denied, without offering a broken Enable action", () => {
    mocks.getPushPermissionState.mockReturnValue("denied");
    render(<BadgePermissionCard />);

    expect((screen.getByLabelText("Notifications") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/notifications are blocked for this device/i)).not.toBeNull();
  });
});
