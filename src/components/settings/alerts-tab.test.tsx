// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  useDeviceNotifications: vi.fn()
}));

vi.mock("@/components/layout/push-notification-provider", () => ({
  useDeviceNotifications: mocks.useDeviceNotifications
}));

import { AlertsTab } from "./alerts-tab";

function baseProps(overrides: Partial<ComponentProps<typeof AlertsTab>> = {}) {
  return {
    rules: [],
    enabledByType: {},
    autoSyncEnabled: true,
    isDemo: false,
    latestBalance: null,
    insights: null,
    suggestedMonthlyBudget: null,
    hasTariffProfile: false,
    onEnabledChange: vi.fn(),
    onAutoSyncEnabledChange: vi.fn(),
    ...overrides
  };
}

// Device-status state matrix (off/blocked/unsupported/error) belongs to
// DeviceNotificationStatus itself -- see device-notification-status.test.tsx.
// This file only checks AlertsTab wires that section in and still renders
// its groups.
describe("AlertsTab", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useDeviceNotifications.mockReturnValue({
      browserPermission: "default",
      subscriptionActive: false,
      checking: false,
      enableDeviceNotifications: vi.fn(),
      disableDeviceNotifications: vi.fn(),
      refreshDeviceNotificationState: vi.fn()
    });
  });

  it("renders the device-notification status section near the top", () => {
    render(<AlertsTab {...baseProps()} />);
    expect(screen.queryByText("Phone notifications are off")).not.toBeNull();
  });

  it("omits the device-notification status section once this device is subscribed", () => {
    mocks.useDeviceNotifications.mockReturnValue({
      browserPermission: "granted",
      subscriptionActive: true,
      checking: false,
      enableDeviceNotifications: vi.fn(),
      disableDeviceNotifications: vi.fn(),
      refreshDeviceNotificationState: vi.fn()
    });
    render(<AlertsTab {...baseProps()} />);
    expect(screen.queryByText("Push notifications are off on this device.")).toBeNull();
  });

  it("renders every group label, even with zero rules configured", () => {
    render(<AlertsTab {...baseProps()} />);
    for (const label of ["Balance & spending", "Usage & tariff", "More", "System"]) {
      expect(screen.queryByText(label)).not.toBeNull();
    }
  });
});
