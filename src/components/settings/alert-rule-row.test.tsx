// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
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

describe("AlertRuleRow", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(defaultRuleResponse()));
    mocks.getPushPermissionState.mockReturnValue("granted");
    mocks.ensurePushNotificationsEnabled.mockResolvedValue({ status: "granted" });
    mocks.hasDismissedPushPrompt.mockReturnValue(false);
  });

  describe("everything already enabled (Case 1)", () => {
    it("enables the alert directly with no permission dialog, and silently confirms the subscription", async () => {
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);

      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.queryByText(/Get low balance notifications/i)).toBeNull();
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      expect(mocks.ensurePushNotificationsEnabled).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/couldn't be registered/i)).toBeNull();
    });
  });

  describe("permission default", () => {
    beforeEach(() => {
      mocks.getPushPermissionState.mockReturnValue("default");
    });

    it("shows the NewinMeter explainer instead of saving immediately, without calling ensurePushNotificationsEnabled yet", () => {
      render(<AlertRuleRow {...baseProps()} />);
      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.queryByText("Get low balance notifications")).not.toBeNull();
      expect(mocks.ensurePushNotificationsEnabled).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("only calls ensurePushNotificationsEnabled after the user clicks Enable notifications, then saves", async () => {
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);
      fireEvent.click(screen.getByLabelText("Low balance"));

      fireEvent.click(screen.getByText("Enable notifications"));

      await waitFor(() => expect(mocks.ensurePushNotificationsEnabled).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      expect(screen.queryByText("Get low balance notifications")).toBeNull();
    });

    it("still enables the alert when the user chooses Not now, without requesting permission", async () => {
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);
      fireEvent.click(screen.getByLabelText("Low balance"));

      fireEvent.click(screen.getByText("Not now"));

      expect(mocks.ensurePushNotificationsEnabled).not.toHaveBeenCalled();
      expect(mocks.markPushPromptDismissed).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      await waitFor(() =>
        expect(screen.queryByText(/You'll still see alerts in NewinMeter, but this device won't notify you/i)).not.toBeNull()
      );
    });
  });

  describe("permission denied", () => {
    beforeEach(() => {
      mocks.getPushPermissionState.mockReturnValue("denied");
    });

    it("never shows the dialog and never calls ensurePushNotificationsEnabled, but still enables the alert", async () => {
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);
      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.queryByText("Get low balance notifications")).toBeNull();
      expect(mocks.ensurePushNotificationsEnabled).not.toHaveBeenCalled();
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      await waitFor(() => expect(screen.queryByText(/notifications are blocked on this device/i)).not.toBeNull());
    });
  });

  describe("subscription failure", () => {
    it("keeps the alert enabled and shows a recoverable warning, without an error state", async () => {
      mocks.getPushPermissionState.mockReturnValue("granted");
      mocks.ensurePushNotificationsEnabled.mockResolvedValue({ status: "subscription_failed" });
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);

      fireEvent.click(screen.getByLabelText("Low balance"));

      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      await waitFor(() => expect(screen.queryByText(/couldn't be registered for push notifications/i)).not.toBeNull());
      expect(screen.queryByText("Couldn't save this alert.")).toBeNull();
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

    it("enables auto-sync + the alert on confirm, propagates nextSyncAt, then still runs the push step", async () => {
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
      mocks.getPushPermissionState.mockReturnValue("granted");
      const onEnabledChange = vi.fn();
      const onAutoSyncEnabledChange = vi.fn();
      render(<AlertRuleRow {...autoSyncOffProps({ onEnabledChange, onAutoSyncEnabledChange })} />);

      fireEvent.click(screen.getByLabelText("Low balance"));
      fireEvent.click(screen.getByText("Turn both on"));

      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      expect(onAutoSyncEnabledChange).toHaveBeenCalledWith(true, "2026-08-25T00:00:00.000Z");
      expect(mocks.ensurePushNotificationsEnabled).toHaveBeenCalledTimes(1);

      const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
      expect(body).toEqual({ enabled: true, threshold: 170, alsoEnableAutoSync: true });
    });
  });

  describe("prompt suppression", () => {
    it("does not show the dialog again once dismissed once, even though permission is still default", async () => {
      mocks.getPushPermissionState.mockReturnValue("default");
      mocks.hasDismissedPushPrompt.mockReturnValue(true);
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);

      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.queryByText("Get low balance notifications")).toBeNull();
      expect(mocks.ensurePushNotificationsEnabled).not.toHaveBeenCalled();
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
    });
  });

  describe("unsupported browser", () => {
    it("enables the alert with no crash and a clear in-app-only message", async () => {
      mocks.getPushPermissionState.mockReturnValue("unsupported");
      const onEnabledChange = vi.fn();
      render(<AlertRuleRow {...baseProps({ onEnabledChange })} />);

      fireEvent.click(screen.getByLabelText("Low balance"));

      expect(screen.queryByText("Get low balance notifications")).toBeNull();
      expect(mocks.ensurePushNotificationsEnabled).not.toHaveBeenCalled();
      await waitFor(() => expect(onEnabledChange).toHaveBeenCalledWith("low_balance", true));
      await waitFor(() => expect(screen.queryByText(/Push notifications aren't available on this device/i)).not.toBeNull());
    });
  });
});
