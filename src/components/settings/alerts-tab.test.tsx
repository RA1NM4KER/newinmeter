// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  useDeviceNotifications: vi.fn(),
  hasDismissedDeviceNotifications: vi.fn(),
  markDeviceNotificationsDismissed: vi.fn()
}));

vi.mock("@/components/layout/push-notification-provider", () => ({
  useDeviceNotifications: mocks.useDeviceNotifications
}));
vi.mock("@/lib/push-client", () => ({
  hasDismissedDeviceNotifications: mocks.hasDismissedDeviceNotifications,
  markDeviceNotificationsDismissed: mocks.markDeviceNotificationsDismissed
}));

import { AlertsTab } from "./alerts-tab";

function baseProps(overrides: Partial<ComponentProps<typeof AlertsTab>> = {}) {
  return {
    rules: [],
    enabledByType: {},
    autoSyncEnabled: true,
    isDemo: false,
    latestBalance: null,
    onEnabledChange: vi.fn(),
    onAutoSyncEnabledChange: vi.fn(),
    ...overrides
  };
}

function setDeviceNotifications(subscriptionActive: boolean) {
  mocks.useDeviceNotifications.mockReturnValue({
    browserPermission: subscriptionActive ? "granted" : "denied",
    subscriptionActive,
    checking: false,
    enableDeviceNotifications: vi.fn(),
    disableDeviceNotifications: vi.fn(),
    refreshDeviceNotificationState: vi.fn()
  });
}

const STATUS_TEXT = /Alerts are active, but this device isn't sending push notifications/i;

describe("AlertsTab device-status messaging", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasDismissedDeviceNotifications.mockReturnValue(false);
  });

  it("says nothing when no alert is enabled yet, even if device push is off", () => {
    setDeviceNotifications(false);
    render(<AlertsTab {...baseProps({ enabledByType: {} })} />);
    expect(screen.queryByText(STATUS_TEXT)).toBeNull();
  });

  it("says nothing when device push is on (subscriptionActive), regardless of enabled alerts", () => {
    setDeviceNotifications(true);
    render(<AlertsTab {...baseProps({ enabledByType: { low_balance: true } })} />);
    expect(screen.queryByText(STATUS_TEXT)).toBeNull();
  });

  it("shows the subtle status line when an alert is enabled and device push is off, even with permission granted", () => {
    mocks.useDeviceNotifications.mockReturnValue({
      browserPermission: "granted",
      subscriptionActive: false,
      checking: false,
      enableDeviceNotifications: vi.fn(),
      disableDeviceNotifications: vi.fn(),
      refreshDeviceNotificationState: vi.fn()
    });
    render(<AlertsTab {...baseProps({ enabledByType: { daily_spend: true } })} />);
    expect(screen.queryByText(STATUS_TEXT)).not.toBeNull();
  });
});
