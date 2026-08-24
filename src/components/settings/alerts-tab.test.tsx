// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  getPushPermissionState: vi.fn(),
  ensurePushNotificationsEnabled: vi.fn(),
  hasDismissedPushPrompt: vi.fn(),
  markPushPromptDismissed: vi.fn()
}));

vi.mock("@/lib/push-client", () => ({
  getPushPermissionState: mocks.getPushPermissionState,
  ensurePushNotificationsEnabled: mocks.ensurePushNotificationsEnabled,
  hasDismissedPushPrompt: mocks.hasDismissedPushPrompt,
  markPushPromptDismissed: mocks.markPushPromptDismissed
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

const STATUS_TEXT = /Alerts are active, but this device isn't sending push notifications/i;

describe("AlertsTab device-status messaging", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasDismissedPushPrompt.mockReturnValue(false);
  });

  it("says nothing when no alert is enabled yet, even if push isn't granted", () => {
    mocks.getPushPermissionState.mockReturnValue("denied");
    render(<AlertsTab {...baseProps({ enabledByType: {} })} />);
    expect(screen.queryByText(STATUS_TEXT)).toBeNull();
  });

  it("says nothing when push is granted, regardless of enabled alerts", () => {
    mocks.getPushPermissionState.mockReturnValue("granted");
    render(<AlertsTab {...baseProps({ enabledByType: { low_balance: true } })} />);
    expect(screen.queryByText(STATUS_TEXT)).toBeNull();
  });

  it("shows the subtle status line when an alert is enabled and push is not granted", () => {
    mocks.getPushPermissionState.mockReturnValue("denied");
    render(<AlertsTab {...baseProps({ enabledByType: { daily_spend: true } })} />);
    expect(screen.queryByText(STATUS_TEXT)).not.toBeNull();
  });
});
