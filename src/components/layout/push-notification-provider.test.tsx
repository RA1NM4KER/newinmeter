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
    // Denied is terminal -- never worth checking for/repairing a
    // subscription that the OS won't deliver to anyway.
    expect(mocks.hasActiveSubscription).not.toHaveBeenCalled();
    expect(mocks.repairExistingSubscription).not.toHaveBeenCalled();
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

  // The iOS/PWA resume bug this whole task fixes: the app never reloads
  // when the user hops to iPhone Settings and back, so without a resume
  // listener, state from initial mount goes stale.
  describe("resume (iOS/PWA foreground) refresh", () => {
    function setVisibilityState(state: DocumentVisibilityState) {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
    }

    afterEach(() => {
      setVisibilityState("visible");
    });

    it("visibilitychange back to visible re-checks permission and subscription state", async () => {
      mocks.getPushPermissionState.mockReturnValue("granted");
      mocks.hasActiveSubscription.mockResolvedValue(true);
      render(
        <PushNotificationProvider>
          <Probe />
        </PushNotificationProvider>
      );
      await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("true"));
      expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(1);

      // Simulate returning from iPhone Settings having revoked permission.
      mocks.getPushPermissionState.mockReturnValue("denied");
      setVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      await waitFor(() => expect(screen.getByTestId("probe-permission").textContent).toBe("denied"));
      expect(screen.getByTestId("probe-active").textContent).toBe("false");
      expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(2);
    });

    it("does not refresh on visibilitychange when the document becomes hidden", async () => {
      mocks.getPushPermissionState.mockReturnValue("granted");
      mocks.hasActiveSubscription.mockResolvedValue(true);
      render(
        <PushNotificationProvider>
          <Probe />
        </PushNotificationProvider>
      );
      await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("true"));
      expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(1);

      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));

      // Give any (incorrect) refresh a chance to run before asserting it didn't.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(1);
    });

    it("window focus also triggers a refresh", async () => {
      mocks.getPushPermissionState.mockReturnValue("granted");
      mocks.hasActiveSubscription.mockResolvedValue(true);
      render(
        <PushNotificationProvider>
          <Probe />
        </PushNotificationProvider>
      );
      await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("true"));
      expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event("focus"));

      await waitFor(() => expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(2));
    });

    it("coalesces visibilitychange + focus firing together into a single refresh", async () => {
      mocks.getPushPermissionState.mockReturnValue("granted");
      mocks.hasActiveSubscription.mockResolvedValue(true);
      render(
        <PushNotificationProvider>
          <Probe />
        </PushNotificationProvider>
      );
      await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("true"));
      expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(1);

      // Both commonly fire for the same real resume moment.
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));

      await waitFor(() => expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(2));
      // Give a moment for a second (incorrect) refresh to have started too.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(2);
    });

    it("a permission revoked on resume never calls requestPermission (via ensurePushNotificationsEnabled)", async () => {
      mocks.getPushPermissionState.mockReturnValue("granted");
      mocks.hasActiveSubscription.mockResolvedValue(true);
      render(
        <PushNotificationProvider>
          <Probe />
        </PushNotificationProvider>
      );
      await waitFor(() => expect(screen.getByTestId("probe-active").textContent).toBe("true"));

      // Only care about calls made *during the resume pass*, not the
      // initial mount's own (legitimate) check.
      mocks.hasActiveSubscription.mockClear();
      mocks.getPushPermissionState.mockReturnValue("denied");
      window.dispatchEvent(new Event("focus"));

      await waitFor(() => expect(screen.getByTestId("probe-permission").textContent).toBe("denied"));
      expect(screen.getByTestId("probe-active").textContent).toBe("false");
      expect(mocks.hasActiveSubscription).not.toHaveBeenCalled();
      expect(mocks.ensurePushNotificationsEnabled).not.toHaveBeenCalled();
    });

    it("permission granted again on resume does not auto-subscribe if device notifications were explicitly off", async () => {
      // Starts off: permission default, no subscription (device notifications OFF).
      mocks.getPushPermissionState.mockReturnValue("default");
      mocks.hasActiveSubscription.mockResolvedValue(false);
      render(
        <PushNotificationProvider>
          <Probe />
        </PushNotificationProvider>
      );
      await waitFor(() => expect(screen.getByTestId("probe-checking").textContent).toBe("false"));
      expect(screen.getByTestId("probe-active").textContent).toBe("false");

      // User grants permission via iPhone Settings, returns to the app --
      // but never subscribed this device (General was OFF), so there's
      // still no browser PushSubscription to find.
      mocks.getPushPermissionState.mockReturnValue("granted");
      window.dispatchEvent(new Event("focus"));

      await waitFor(() => expect(screen.getByTestId("probe-permission").textContent).toBe("granted"));
      // Still OFF -- OS permission alone never flips General/subscriptionActive on.
      expect(screen.getByTestId("probe-active").textContent).toBe("false");
      expect(mocks.ensurePushNotificationsEnabled).not.toHaveBeenCalled();
    });

    it("removes its resume listeners on unmount", async () => {
      mocks.getPushPermissionState.mockReturnValue("granted");
      mocks.hasActiveSubscription.mockResolvedValue(true);
      const { unmount } = render(
        <PushNotificationProvider>
          <Probe />
        </PushNotificationProvider>
      );
      await waitFor(() => expect(mocks.getPushPermissionState).toHaveBeenCalledTimes(1));

      unmount();
      mocks.getPushPermissionState.mockClear();

      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mocks.getPushPermissionState).not.toHaveBeenCalled();
    });
  });
});
