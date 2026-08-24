// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function installNotification(permission: NotificationPermission, requestPermission = vi.fn()) {
  (globalThis as unknown as { Notification: unknown }).Notification = {
    permission,
    requestPermission
  };
  return requestPermission;
}

function removeNotification() {
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
}

function installServiceWorkerAndPushManager(overrides?: {
  getSubscription?: () => Promise<unknown>;
  subscribe?: () => Promise<unknown>;
}) {
  const pushManager = {
    getSubscription: overrides?.getSubscription ?? vi.fn().mockResolvedValue(null),
    subscribe: overrides?.subscribe ?? vi.fn().mockResolvedValue({ toJSON: () => ({ endpoint: "https://x", keys: {} }) })
  };
  const registration = { pushManager };

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve(registration) }
  });
  (globalThis as unknown as { PushManager: unknown }).PushManager = class {};

  return { pushManager, registration };
}

function removeServiceWorkerAndPushManager() {
  // Deleting (not just setting to undefined) so "serviceWorker" in navigator
  // is actually false -- matches how a real unsupported browser looks, and
  // matches what push-client.ts's own support checks test for.
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  delete (globalThis as unknown as { PushManager?: unknown }).PushManager;
}

describe("push-client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    // subscribeToPush() no-ops without this -- set before each dynamic
    // import so the module's top-level read picks it up fresh.
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "AAAA";
  });

  afterEach(() => {
    removeNotification();
    removeServiceWorkerAndPushManager();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("getPushPermissionState", () => {
    it("returns unsupported when the Notification API doesn't exist", async () => {
      removeNotification();
      const { getPushPermissionState } = await import("./push-client");
      expect(getPushPermissionState()).toBe("unsupported");
    });

    it("returns unsupported when serviceWorker or PushManager is missing even if Notification exists", async () => {
      installNotification("granted");
      removeServiceWorkerAndPushManager();
      const { getPushPermissionState } = await import("./push-client");
      expect(getPushPermissionState()).toBe("unsupported");
    });

    it("reflects the real Notification.permission when everything is supported", async () => {
      installNotification("denied");
      installServiceWorkerAndPushManager();
      const { getPushPermissionState } = await import("./push-client");
      expect(getPushPermissionState()).toBe("denied");
    });
  });

  describe("ensurePushNotificationsEnabled", () => {
    it("returns unsupported and never touches Notification when the platform lacks support", async () => {
      removeNotification();
      removeServiceWorkerAndPushManager();
      const { ensurePushNotificationsEnabled } = await import("./push-client");
      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({ status: "unsupported" });
    });

    it("does not call requestPermission when permission is already granted, and subscribes", async () => {
      const requestPermission = installNotification("granted");
      installServiceWorkerAndPushManager();
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({ status: "granted" });
      expect(requestPermission).not.toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/push/subscribe", expect.objectContaining({ method: "POST" }));
    });

    it("does not call requestPermission when permission is already denied, and never subscribes", async () => {
      const requestPermission = installNotification("denied");
      installServiceWorkerAndPushManager();
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({ status: "denied" });
      expect(requestPermission).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("calls requestPermission when permission is default, and subscribes on grant", async () => {
      const requestPermission = vi.fn().mockResolvedValue("granted");
      installNotification("default", requestPermission);
      installServiceWorkerAndPushManager();
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({ status: "granted" });
      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalled();
    });

    it("returns denied (no subscribe attempt) when the user denies via the prompt", async () => {
      const requestPermission = vi.fn().mockResolvedValue("denied");
      installNotification("default", requestPermission);
      installServiceWorkerAndPushManager();
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({ status: "denied" });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns subscription_failed with reason server_registration_failed when the browser subscription succeeds but NewinMeter's API call fails", async () => {
      installNotification("granted");
      installServiceWorkerAndPushManager();
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({
        status: "subscription_failed",
        reason: "server_registration_failed"
      });
    });

    it("returns subscription_failed with reason client_setup_failed when the VAPID public key is missing -- distinct from a real browser refusal", async () => {
      installNotification("granted");
      installServiceWorkerAndPushManager();
      delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({
        status: "subscription_failed",
        reason: "client_setup_failed"
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("returns subscription_failed with reason browser_registration_failed (not thrown) when PushManager.subscribe rejects -- e.g. Brave's push-service AbortError", async () => {
      installNotification("granted");
      installServiceWorkerAndPushManager({
        subscribe: vi.fn().mockRejectedValue(new Error("Registration failed - push service error"))
      });
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({
        status: "subscription_failed",
        reason: "browser_registration_failed"
      });
      // The whole point: a browser-side subscribe failure must never reach
      // NewinMeter's own API at all.
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("retries and succeeds after a previous browser-side failure, with no page reload needed", async () => {
      installNotification("granted");
      const subscribe = vi
        .fn()
        .mockRejectedValueOnce(new Error("Registration failed - push service error"))
        .mockResolvedValueOnce({ toJSON: () => ({ endpoint: "https://retry-ok", keys: {} }) });
      installServiceWorkerAndPushManager({ subscribe });
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({
        status: "subscription_failed",
        reason: "browser_registration_failed"
      });
      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({ status: "granted" });
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("reuses an existing subscription instead of creating a new one", async () => {
      const existing = { toJSON: () => ({ endpoint: "https://existing", keys: {} }) };
      installNotification("granted");
      const { pushManager } = installServiceWorkerAndPushManager({
        getSubscription: vi.fn().mockResolvedValue(existing)
      });
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({ status: "granted" });
      expect(pushManager.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("hasActiveSubscription", () => {
    it("is false without serviceWorker support", async () => {
      removeServiceWorkerAndPushManager();
      const { hasActiveSubscription } = await import("./push-client");
      await expect(hasActiveSubscription()).resolves.toBe(false);
    });

    it("reflects whether a subscription currently exists", async () => {
      installServiceWorkerAndPushManager({ getSubscription: vi.fn().mockResolvedValue({ endpoint: "x" }) });
      const { hasActiveSubscription } = await import("./push-client");
      await expect(hasActiveSubscription()).resolves.toBe(true);
    });
  });

  describe("unsubscribeFromPush", () => {
    it("unsubscribes the browser and removes only this exact endpoint server-side", async () => {
      const subscription = {
        endpoint: "https://push.example.com/this-device-only",
        unsubscribe: vi.fn().mockResolvedValue(true)
      };
      installServiceWorkerAndPushManager({ getSubscription: vi.fn().mockResolvedValue(subscription) });
      const { unsubscribeFromPush } = await import("./push-client");

      await unsubscribeFromPush();

      expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/push/unsubscribe",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ endpoint: "https://push.example.com/this-device-only" })
        })
      );
    });

    it("is a no-op when there is no subscription to remove", async () => {
      installServiceWorkerAndPushManager({ getSubscription: vi.fn().mockResolvedValue(null) });
      const { unsubscribeFromPush } = await import("./push-client");

      await unsubscribeFromPush();

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe("device-notifications dismissal", () => {
    it("is not dismissed by default", async () => {
      const { hasDismissedDeviceNotifications } = await import("./push-client");
      expect(hasDismissedDeviceNotifications()).toBe(false);
    });

    it("persists across calls once marked dismissed, via localStorage", async () => {
      const { hasDismissedDeviceNotifications, markDeviceNotificationsDismissed } = await import("./push-client");
      markDeviceNotificationsDismissed();
      expect(hasDismissedDeviceNotifications()).toBe(true);
      expect(window.localStorage.getItem("newinmeter:device-notifications-dismissed")).toBe("1");
    });

    it("clears the dismissal so it no longer suppresses anything", async () => {
      const { hasDismissedDeviceNotifications, markDeviceNotificationsDismissed, clearDeviceNotificationsDismissed } =
        await import("./push-client");
      markDeviceNotificationsDismissed();
      expect(hasDismissedDeviceNotifications()).toBe(true);

      clearDeviceNotificationsDismissed();
      expect(hasDismissedDeviceNotifications()).toBe(false);
    });
  });

  describe("repairExistingSubscription", () => {
    it("is a no-op (never creates a subscription) when none currently exists", async () => {
      installServiceWorkerAndPushManager({ getSubscription: vi.fn().mockResolvedValue(null) });
      const { repairExistingSubscription } = await import("./push-client");

      await expect(repairExistingSubscription()).resolves.toBe(false);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("re-registers an existing subscription with the server without creating a new one", async () => {
      const existing = { toJSON: () => ({ endpoint: "https://existing", keys: {} }) };
      const { pushManager } = installServiceWorkerAndPushManager({
        getSubscription: vi.fn().mockResolvedValue(existing)
      });
      const { repairExistingSubscription } = await import("./push-client");

      await expect(repairExistingSubscription()).resolves.toBe(true);
      expect(pushManager.subscribe).not.toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/push/subscribe",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("returns false rather than throwing when the server round trip fails", async () => {
      const existing = { toJSON: () => ({ endpoint: "https://existing", keys: {} }) };
      installServiceWorkerAndPushManager({ getSubscription: vi.fn().mockResolvedValue(existing) });
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
      const { repairExistingSubscription } = await import("./push-client");

      await expect(repairExistingSubscription()).resolves.toBe(false);
    });
  });

  describe("isBraveBrowser", () => {
    afterEach(() => {
      delete (navigator as unknown as { brave?: unknown }).brave;
    });

    it("is false when navigator.brave doesn't exist", async () => {
      const { isBraveBrowser } = await import("./push-client");
      expect(isBraveBrowser()).toBe(false);
    });

    it("is true when navigator.brave exists", async () => {
      Object.defineProperty(navigator, "brave", { value: {}, configurable: true });
      const { isBraveBrowser } = await import("./push-client");
      expect(isBraveBrowser()).toBe(true);
    });
  });

  describe("describeSubscriptionFailure", () => {
    afterEach(() => {
      delete (navigator as unknown as { brave?: unknown }).brave;
    });

    it("server_registration_failed: always the generic 'try again' copy, Brave or not", async () => {
      Object.defineProperty(navigator, "brave", { value: {}, configurable: true });
      const { describeSubscriptionFailure } = await import("./push-client");
      expect(describeSubscriptionFailure("server_registration_failed")).toBe("Couldn't turn on notifications. Try again.");
    });

    it("browser_registration_failed, ordinary browser: generic browser-settings guidance, no Brave mention", async () => {
      const { describeSubscriptionFailure } = await import("./push-client");
      const message = describeSubscriptionFailure("browser_registration_failed");
      expect(message).toMatch(/browser couldn't register this device/i);
      expect(message).not.toMatch(/brave/i);
    });

    it("browser_registration_failed on Brave: Brave-specific recovery guidance", async () => {
      Object.defineProperty(navigator, "brave", { value: {}, configurable: true });
      const { describeSubscriptionFailure } = await import("./push-client");
      const message = describeSubscriptionFailure("browser_registration_failed");
      expect(message).toMatch(/brave/i);
      expect(message).toMatch(/push messaging/i);
    });

    it("client_setup_failed on Brave: still the generic message, never Brave-specific", async () => {
      // A missing VAPID key or a not-yet-ready service worker is a
      // NewinMeter/deployment problem, not "Brave's push service refused
      // this device" -- must not get the Brave-specific push-messaging
      // copy just because the browser happens to be Brave.
      Object.defineProperty(navigator, "brave", { value: {}, configurable: true });
      const { describeSubscriptionFailure } = await import("./push-client");
      const message = describeSubscriptionFailure("client_setup_failed");
      expect(message).not.toMatch(/brave/i);
      expect(message).toMatch(/browser couldn't register this device/i);
    });
  });
});
