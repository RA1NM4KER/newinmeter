// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPushPermissionState: vi.fn(),
  hasActiveSubscription: vi.fn(),
  repairExistingSubscription: vi.fn(),
  ensurePushNotificationsEnabled: vi.fn(),
  unsubscribeFromPush: vi.fn(),
  clearDeviceNotificationsDismissed: vi.fn()
}));

vi.mock("@/lib/push-client", () => ({
  getPushPermissionState: mocks.getPushPermissionState,
  hasActiveSubscription: mocks.hasActiveSubscription,
  repairExistingSubscription: mocks.repairExistingSubscription,
  ensurePushNotificationsEnabled: mocks.ensurePushNotificationsEnabled,
  unsubscribeFromPush: mocks.unsubscribeFromPush,
  clearDeviceNotificationsDismissed: mocks.clearDeviceNotificationsDismissed
}));

import { PushNotificationProvider, useDeviceNotifications } from "./push-notification-provider";

function Probe({ id = "probe" }: { id?: string }) {
  const { browserPermission, subscriptionActive, checking, enableDeviceNotifications, disableDeviceNotifications } =
    useDeviceNotifications();
  return (
    <div data-testid={id}>
      <span data-testid={`${id}-permission`}>{browserPermission}</span>
      <span data-testid={`${id}-active`}>{String(subscriptionActive)}</span>
      <span data-testid={`${id}-checking`}>{String(checking)}</span>
      <button onClick={() => void enableDeviceNotifications()}>enable-{id}</button>
      <button onClick={() => void disableDeviceNotifications()}>disable-{id}</button>
    </div>
  );
}

describe("PushNotificationProvider", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repairExistingSubscription.mockResolvedValue(true);
  });

  it("reflects ON only once the browser subscription is confirmed registered server-side", async () => {
    mocks.getPushPermissionState.mockReturnValue("granted");
    mocks.hasActiveSubscription.mockResolvedValue(true);
    mocks.repairExistingSubscription.mockResolvedValue(true);
    render(
      <PushNotificationProvider>
        <Probe />
      </PushNotificationProvider>
    );

    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("true"));
    expect(screen.getByTestId("probe-permission").textContent).toBe("granted");
    // Repair (re-register an existing subscription) is attempted -- never
    // creates a new one; ensurePushNotificationsEnabled is never called
    // during a silent initialization check.
    expect(mocks.repairExistingSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.ensurePushNotificationsEnabled).not.toHaveBeenCalled();
  });

  it("reports OFF -- not a false ON -- when the browser has a subscription the server can't confirm", async () => {
    mocks.getPushPermissionState.mockReturnValue("granted");
    mocks.hasActiveSubscription.mockResolvedValue(true);
    // Browser object exists, but the server round trip to (re-)register it
    // fails -- e.g. its push_subscriptions row was deleted independently.
    mocks.repairExistingSubscription.mockResolvedValue(false);
    render(
      <PushNotificationProvider>
        <Probe />
      </PushNotificationProvider>
    );

    await waitFor(() => expect(screen.getByTestId("probe-checking").textContent).toBe("false"));
    expect(screen.getByTestId("probe-active").textContent).toBe("false");
    expect(mocks.repairExistingSubscription).toHaveBeenCalledTimes(1);
    // Never silently "created" a replacement subscription for this.
    expect(mocks.ensurePushNotificationsEnabled).not.toHaveBeenCalled();
    expect(mocks.clearDeviceNotificationsDismissed).not.toHaveBeenCalled();
  });

  it("reflects granted permission + no subscription as OFF -- the core bug fix", async () => {
    mocks.getPushPermissionState.mockReturnValue("granted");
    mocks.hasActiveSubscription.mockResolvedValue(false);
    render(
      <PushNotificationProvider>
        <Probe />
      </PushNotificationProvider>
    );

    await waitFor(() => expect(screen.getByTestId("probe-checking").textContent).toBe("false"));
    expect(screen.getByTestId("probe-active").textContent).toBe("false");
    expect(screen.getByTestId("probe-permission").textContent).toBe("granted");
    expect(mocks.repairExistingSubscription).not.toHaveBeenCalled();
  });

  it("reflects default permission + no subscription as OFF", async () => {
    mocks.getPushPermissionState.mockReturnValue("default");
    mocks.hasActiveSubscription.mockResolvedValue(false);
    render(
      <PushNotificationProvider>
        <Probe />
      </PushNotificationProvider>
    );

    await waitFor(() => expect(screen.getByTestId("probe-checking").textContent).toBe("false"));
    expect(screen.getByTestId("probe-active").textContent).toBe("false");
  });

  it("reflects denied permission as OFF and never checks for a subscription", async () => {
    mocks.getPushPermissionState.mockReturnValue("denied");
    render(
      <PushNotificationProvider>
        <Probe />
      </PushNotificationProvider>
    );

    await waitFor(() => expect(screen.getByTestId("probe-checking").textContent).toBe("false"));
    expect(screen.getByTestId("probe-active").textContent).toBe("false");
    expect(screen.getByTestId("probe-permission").textContent).toBe("denied");
  });

  it("unsupported short-circuits to OFF without checking for a subscription", async () => {
    mocks.getPushPermissionState.mockReturnValue("unsupported");
    render(
      <PushNotificationProvider>
        <Probe />
      </PushNotificationProvider>
    );

    await waitFor(() => expect(screen.getByTestId("probe-checking").textContent).toBe("false"));
    expect(screen.getByTestId("probe-active").textContent).toBe("false");
    expect(mocks.hasActiveSubscription).not.toHaveBeenCalled();
  });

  it("enableDeviceNotifications turns subscriptionActive on and clears the dismissal flag on success", async () => {
    mocks.getPushPermissionState.mockReturnValue("granted");
    mocks.hasActiveSubscription.mockResolvedValue(false);
    mocks.ensurePushNotificationsEnabled.mockResolvedValue({ status: "granted" });
    render(
      <PushNotificationProvider>
        <Probe />
      </PushNotificationProvider>
    );
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("false"));

    fireEvent.click(screen.getByText("enable-probe"));

    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("true"));
    expect(mocks.clearDeviceNotificationsDismissed).toHaveBeenCalledTimes(1);
  });

  it("enableDeviceNotifications leaves subscriptionActive off on failure, without clearing the dismissal flag", async () => {
    mocks.getPushPermissionState.mockReturnValue("granted");
    mocks.hasActiveSubscription.mockResolvedValue(false);
    mocks.ensurePushNotificationsEnabled.mockResolvedValue({ status: "subscription_failed" });
    render(
      <PushNotificationProvider>
        <Probe />
      </PushNotificationProvider>
    );
    await waitFor(() => expect(screen.getByTestId("probe-checking").textContent).toBe("false"));

    fireEvent.click(screen.getByText("enable-probe"));

    await waitFor(() => expect(mocks.ensurePushNotificationsEnabled).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("probe-active").textContent).toBe("false");
    expect(mocks.clearDeviceNotificationsDismissed).not.toHaveBeenCalled();
  });

  it("disableDeviceNotifications unsubscribes and flips active off without touching browserPermission", async () => {
    mocks.getPushPermissionState.mockReturnValue("granted");
    mocks.hasActiveSubscription.mockResolvedValue(true);
    mocks.unsubscribeFromPush.mockResolvedValue(undefined);
    render(
      <PushNotificationProvider>
        <Probe />
      </PushNotificationProvider>
    );
    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("true"));

    fireEvent.click(screen.getByText("disable-probe"));

    await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("false"));
    expect(mocks.unsubscribeFromPush).toHaveBeenCalledTimes(1);
    // Browser permission is untouched -- there is no API to revoke it, and
    // the whole point is that it stays "granted" while the device is off.
    expect(screen.getByTestId("probe-permission").textContent).toBe("granted");
  });

  it("does not run duplicate subscription checks for two components mounted under one provider", async () => {
    mocks.getPushPermissionState.mockReturnValue("granted");
    mocks.hasActiveSubscription.mockResolvedValue(true);
    render(
      <PushNotificationProvider>
        <Probe id="a" />
        <Probe id="b" />
      </PushNotificationProvider>
    );

    await waitFor(() => expect(screen.getByTestId("a-active").textContent).toBe("true"));
    expect(screen.getByTestId("b-active").textContent).toBe("true");
    expect(mocks.hasActiveSubscription).toHaveBeenCalledTimes(1);
  });
});
