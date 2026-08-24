// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useDeviceNotifications: vi.fn(),
  enableDeviceNotifications: vi.fn(),
  disableDeviceNotifications: vi.fn()
}));

vi.mock("@/components/layout/push-notification-provider", () => ({
  useDeviceNotifications: mocks.useDeviceNotifications
}));

import { BadgePermissionCard } from "./badge-permission-card";

function setDeviceNotifications(overrides: Partial<{ browserPermission: string; subscriptionActive: boolean; checking: boolean }> = {}) {
  mocks.useDeviceNotifications.mockReturnValue({
    browserPermission: "granted",
    subscriptionActive: false,
    checking: false,
    enableDeviceNotifications: mocks.enableDeviceNotifications,
    disableDeviceNotifications: mocks.disableDeviceNotifications,
    refreshDeviceNotificationState: vi.fn(),
    ...overrides
  });
}

describe("BadgePermissionCard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enableDeviceNotifications.mockResolvedValue({ status: "granted" });
    mocks.disableDeviceNotifications.mockResolvedValue(undefined);
  });

  it("renders nothing when the platform is unsupported", () => {
    setDeviceNotifications({ browserPermission: "unsupported" });
    const { container } = render(<BadgePermissionCard />);
    expect(container.firstChild).toBeNull();
  });

  it("reflects subscriptionActive as ON -- not browserPermission alone", async () => {
    setDeviceNotifications({ browserPermission: "granted", subscriptionActive: true });
    render(<BadgePermissionCard />);
    expect(screen.getByLabelText("Notifications").getAttribute("aria-checked")).toBe("true");
  });

  it("shows OFF when permission is granted but there's no active subscription -- the core bug fix", () => {
    setDeviceNotifications({ browserPermission: "granted", subscriptionActive: false });
    render(<BadgePermissionCard />);
    expect(screen.getByLabelText("Notifications").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText(/Push notifications are off on this device/i)).not.toBeNull();
  });

  it("disables the toggle and explains when permission is denied, without offering a broken Enable action", () => {
    setDeviceNotifications({ browserPermission: "denied", subscriptionActive: false });
    render(<BadgePermissionCard />);

    expect((screen.getByLabelText("Notifications") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/blocked by this device or browser/i)).not.toBeNull();
  });

  it("turning the toggle on calls enableDeviceNotifications", async () => {
    setDeviceNotifications({ browserPermission: "granted", subscriptionActive: false });
    render(<BadgePermissionCard />);

    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() => expect(mocks.enableDeviceNotifications).toHaveBeenCalledTimes(1));
  });

  it("turning the toggle off calls disableDeviceNotifications, which is the shared unsubscribe path", async () => {
    setDeviceNotifications({ browserPermission: "granted", subscriptionActive: true });
    render(<BadgePermissionCard />);

    fireEvent.click(screen.getByLabelText("Notifications"));

    await waitFor(() => expect(mocks.disableDeviceNotifications).toHaveBeenCalledTimes(1));
  });
});
