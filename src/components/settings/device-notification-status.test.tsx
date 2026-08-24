// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useDeviceNotifications: vi.fn()
}));

vi.mock("@/components/layout/push-notification-provider", () => ({
  useDeviceNotifications: mocks.useDeviceNotifications
}));

import { DeviceNotificationStatus } from "./device-notification-status";

function setDeviceNotifications(overrides: Partial<ReturnType<typeof mocks.useDeviceNotifications>> = {}) {
  mocks.useDeviceNotifications.mockReturnValue({
    browserPermission: "default",
    subscriptionActive: false,
    checking: false,
    enableDeviceNotifications: vi.fn().mockResolvedValue({ status: "granted" }),
    disableDeviceNotifications: vi.fn(),
    refreshDeviceNotificationState: vi.fn(),
    ...overrides
  });
}

describe("DeviceNotificationStatus", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing while the initial/resume check is still in flight", () => {
    setDeviceNotifications({ checking: true });
    const { container } = render(<DeviceNotificationStatus />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing once this device is actually subscribed", () => {
    setDeviceNotifications({ subscriptionActive: true });
    const { container } = render(<DeviceNotificationStatus />);
    expect(container.innerHTML).toBe("");
  });

  it("permission default: shows the off-state copy and a working Turn on notifications button", async () => {
    const enableDeviceNotifications = vi.fn().mockResolvedValue({ status: "granted" });
    setDeviceNotifications({ browserPermission: "default", enableDeviceNotifications });
    render(<DeviceNotificationStatus />);

    expect(screen.getByText("Push notifications are off on this device.")).toBeDefined();
    expect(screen.getByText("Alerts will still appear in NewinMeter.")).toBeDefined();

    fireEvent.click(screen.getByText("Turn on notifications"));
    await waitFor(() => expect(enableDeviceNotifications).toHaveBeenCalledTimes(1));
  });

  it("permission granted but unsubscribed: still shows the button (subscribes directly, no native prompt)", () => {
    setDeviceNotifications({ browserPermission: "granted", subscriptionActive: false });
    render(<DeviceNotificationStatus />);
    expect(screen.getByText("Turn on notifications")).toBeDefined();
  });

  it("permission denied: explains where to fix it, no retry button", () => {
    setDeviceNotifications({ browserPermission: "denied" });
    render(<DeviceNotificationStatus />);

    expect(screen.getByText("Notifications are blocked for this device.")).toBeDefined();
    expect(
      screen.getByText(/Allow notifications for this site in your browser or device settings/i)
    ).toBeDefined();
    expect(screen.queryByText("Turn on notifications")).toBeNull();
  });

  it("unsupported: explains push isn't available here, no retry button", () => {
    setDeviceNotifications({ browserPermission: "unsupported" });
    render(<DeviceNotificationStatus />);

    expect(screen.getByText("Push notifications aren't available on this device.")).toBeDefined();
    expect(screen.queryByText("Turn on notifications")).toBeNull();
  });

  it("shows a recoverable inline error when subscribing fails, without claiming success", async () => {
    const enableDeviceNotifications = vi.fn().mockResolvedValue({ status: "subscription_failed" });
    setDeviceNotifications({ browserPermission: "granted", enableDeviceNotifications });
    render(<DeviceNotificationStatus />);

    fireEvent.click(screen.getByText("Turn on notifications"));

    await waitFor(() => expect(screen.getByText(/Couldn't turn on notifications/i)).toBeDefined());
  });
});
