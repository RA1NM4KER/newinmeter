// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";

const mocks = vi.hoisted(() => ({
  useDeviceNotifications: vi.fn(),
  enableDeviceNotifications: vi.fn(),
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

import { AlertRuleRow } from "./alert-rule-row";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

function defaultRuleResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    rule: { id: "rule-1", type: "low_balance", enabled: true, threshold: 170, ...overrides },
    autoSyncEnabled: true,
    nextSyncAt: null
  });
}

function baseProps(overrides: Partial<ComponentProps<typeof AlertRuleRow>> = {}) {
  return {
    type: "low_balance" as const,
    title: "Low balance",
    description: "Notify me when my balance drops below this amount.",
    unit: "currency" as const,
    defaultThreshold: 170,
    initialThreshold: null,
    enabled: false,
    autoSyncEnabled: true,
    isDemo: false,
    onEnabledChange: vi.fn(),
    onAutoSyncEnabledChange: vi.fn(),
    ...overrides
  };
}

function setDeviceNotifications(overrides: Partial<{ browserPermission: string; subscriptionActive: boolean }> = {}) {
  mocks.useDeviceNotifications.mockReturnValue({
    browserPermission: "granted",
    subscriptionActive: false,
    checking: false,
    enableDeviceNotifications: mocks.enableDeviceNotifications,
    disableDeviceNotifications: vi.fn(),
    refreshDeviceNotificationState: vi.fn(),
    ...overrides
  });
}

describe("AlertRuleRow", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(defaultRuleResponse()));
    mocks.enableDeviceNotifications.mockResolvedValue({ status: "granted" });
    mocks.hasDismissedDeviceNotifications.mockReturnValue(false);
    setDeviceNotifications();
  });

  describe("device push already on", () => {
    it("enables the alert directly with no dialog, and never calls enableDeviceNotifications", async () => {
      setDeviceNotifications({ subscriptionActive: true });
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);

      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.queryByText("Turn on notifications?")).toBeNull();
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      expect(mocks.enableDeviceNotifications).not.toHaveBeenCalled();
      expect(screen.queryByText(/couldn't be registered/i)).toBeNull();
    });
  });

  describe("device push off, browser permission granted", () => {
    beforeEach(() => {
      setDeviceNotifications({ browserPermission: "granted", subscriptionActive: false });
    });

    it("shows the Turn on notifications? dialog instead of silently resubscribing", () => {
      render(<AlertRuleRow {...baseProps()} />);
      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.queryByText("Turn on notifications?")).not.toBeNull();
      expect(mocks.enableDeviceNotifications).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("Turn on notifications enables the subscription (no native prompt needed) and the alert", async () => {
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);
      fireEvent.click(screen.getByLabelText("Low balance"));

      fireEvent.click(screen.getByText("Turn on notifications"));

      await waitFor(() => expect(mocks.enableDeviceNotifications).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      expect(screen.queryByText("Turn on notifications?")).toBeNull();
    });

    it("Keep notifications off enables the alert without subscribing, and marks the dismissal", async () => {
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);
      fireEvent.click(screen.getByLabelText("Low balance"));

      fireEvent.click(screen.getByText("Keep notifications off"));

      expect(mocks.enableDeviceNotifications).not.toHaveBeenCalled();
      expect(mocks.markDeviceNotificationsDismissed).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      await waitFor(() =>
        expect(screen.queryByText(/You'll see alerts in NewinMeter, but this device won't send push notifications/i)).not.toBeNull()
      );
    });
  });

  describe("device push off, browser permission default", () => {
    beforeEach(() => {
      setDeviceNotifications({ browserPermission: "default", subscriptionActive: false });
    });

    it("shows the same dialog; native requestPermission only happens inside enableDeviceNotifications after Turn on notifications", async () => {
      render(<AlertRuleRow {...baseProps()} />);
      fireEvent.click(screen.getByLabelText("Low balance"));
      expect(mocks.enableDeviceNotifications).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText("Turn on notifications"));
      await waitFor(() => expect(mocks.enableDeviceNotifications).toHaveBeenCalledTimes(1));
    });
  });

  describe("browser permission denied", () => {
    beforeEach(() => {
      setDeviceNotifications({ browserPermission: "denied", subscriptionActive: false });
    });

    it("never shows the dialog (nothing there could work) and never re-requests, but still enables the alert", async () => {
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);
      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.queryByText("Turn on notifications?")).toBeNull();
      expect(mocks.enableDeviceNotifications).not.toHaveBeenCalled();
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      await waitFor(() => expect(screen.queryByText(/notifications are blocked on this device/i)).not.toBeNull());
    });
  });

  describe("subscription failure via Turn on notifications", () => {
    it("keeps the alert enabled and shows a recoverable warning, without an error state", async () => {
      setDeviceNotifications({ browserPermission: "granted", subscriptionActive: false });
      mocks.enableDeviceNotifications.mockResolvedValue({ status: "subscription_failed" });
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);

      fireEvent.click(screen.getByLabelText("Low balance"));
      fireEvent.click(screen.getByText("Turn on notifications"));

      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      await waitFor(() => expect(screen.queryByText(/couldn't be registered for push notifications/i)).not.toBeNull());
      expect(screen.queryByText("Couldn't save this alert.")).toBeNull();
    });
  });

  describe("anti-nag: already dismissed on this device", () => {
    it("does not show the dialog again, even with permission granted and push off", async () => {
      setDeviceNotifications({ browserPermission: "granted", subscriptionActive: false });
      mocks.hasDismissedDeviceNotifications.mockReturnValue(true);
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);

      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.queryByText("Turn on notifications?")).toBeNull();
      expect(mocks.enableDeviceNotifications).not.toHaveBeenCalled();
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
    });
  });

  describe("auto-sync dependency", () => {
    function autoSyncOffProps(overrides: Partial<ComponentProps<typeof AlertRuleRow>> = {}) {
      return baseProps({ autoSyncEnabled: false, ...overrides });
    }

    it("leaves the alert disabled when the auto-sync confirmation is cancelled", () => {
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...autoSyncOffProps({ onEnabledChange })} />);
      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.getByText(/needs fresh LiveMopay data/i)).toBeDefined();
      fireEvent.click(screen.getByText("Cancel"));

      expect(onEnabledChange).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("enables auto-sync + the alert on confirm, propagates nextSyncAt, then still runs the device-push step", async () => {
      setDeviceNotifications({ browserPermission: "granted", subscriptionActive: true });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          jsonResponse({
            rule: { id: "rule-1", type: "low_balance", enabled: true, threshold: 170 },
            autoSyncEnabled: true,
            nextSyncAt: "2026-08-25T00:00:00.000Z"
          })
        )
      );
      const onEnabledChange = vi.fn();
      const onAutoSyncEnabledChange = vi.fn();
      render(<AlertRuleRow {...autoSyncOffProps({ onEnabledChange, onAutoSyncEnabledChange })} />);

      fireEvent.click(screen.getByLabelText("Low balance"));
      fireEvent.click(screen.getByText("Turn both on"));

      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      expect(onAutoSyncEnabledChange).toHaveBeenCalledWith(true, "2026-08-25T00:00:00.000Z");

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ enabled: true, threshold: 170, alsoEnableAutoSync: true });
    });
  });
});
