// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
  useNotificationCentre: vi.fn(),
  useDeviceNotifications: vi.fn()
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useRouter: mocks.useRouter,
  useSearchParams: mocks.useSearchParams
}));
vi.mock("@/components/layout/notification-provider", () => ({
  useNotificationCentre: mocks.useNotificationCentre
}));
vi.mock("@/components/layout/push-notification-provider", () => ({
  useDeviceNotifications: mocks.useDeviceNotifications
}));

import { SettingsPageClient } from "./settings-page-client";

// ThemeToggle (rendered inside the General tab) reads window.matchMedia on
// mount -- not implemented in jsdom by default.
window.matchMedia =
  window.matchMedia ??
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  }));

function baseProps(overrides: Partial<ComponentProps<typeof SettingsPageClient>> = {}) {
  return {
    userEmail: "user@example.com",
    avatarInitial: "U",
    connection: {
      status: "connected" as const,
      livemopayEmail: null,
      accountLabel: null,
      lastSyncedAt: null,
      isDemo: false,
      autoSyncEnabled: true,
      nextSyncAt: null
    },
    alertsEnabled: true,
    alertRules: [],
    latestBalance: null,
    insights: null,
    suggestedMonthlyBudget: null,
    hasTariffProfile: false,
    ...overrides
  };
}

describe("SettingsPageClient -- Alerts tab visibility", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usePathname.mockReturnValue("/settings");
    mocks.useRouter.mockReturnValue({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() });
    mocks.useSearchParams.mockReturnValue(new URLSearchParams());
    mocks.useNotificationCentre.mockReturnValue({ refresh: vi.fn() });
    mocks.useDeviceNotifications.mockReturnValue({
      browserPermission: "granted",
      subscriptionActive: true,
      checking: false,
      enableDeviceNotifications: vi.fn(),
      disableDeviceNotifications: vi.fn(),
      refreshDeviceNotificationState: vi.fn()
    });
  });

  it("shows the Alerts tab when the user has Alerts access", () => {
    render(<SettingsPageClient {...baseProps({ alertsEnabled: true })} />);
    expect(screen.queryByRole("tab", { name: "Alerts" })).not.toBeNull();
  });

  it("hides the Alerts tab entirely (not shown-disabled) when the user lacks Alerts access", () => {
    render(<SettingsPageClient {...baseProps({ alertsEnabled: false })} />);
    expect(screen.queryByRole("tab", { name: "Alerts" })).toBeNull();
  });

  it("falls back to General even if the URL requests ?tab=alerts for a user without access", () => {
    mocks.useSearchParams.mockReturnValue(new URLSearchParams("tab=alerts"));
    render(<SettingsPageClient {...baseProps({ alertsEnabled: false })} />);
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
  });
});
