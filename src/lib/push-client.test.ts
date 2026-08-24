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

    it("returns subscription_failed (not denied, not thrown) when granted but the server registration fails", async () => {
      installNotification("granted");
      installServiceWorkerAndPushManager();
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({ status: "subscription_failed" });
    });

    it("returns subscription_failed rather than throwing when PushManager.subscribe rejects", async () => {
      installNotification("granted");
      installServiceWorkerAndPushManager({
        subscribe: vi.fn().mockRejectedValue(new Error("blocked"))
      });
      const { ensurePushNotificationsEnabled } = await import("./push-client");

      await expect(ensurePushNotificationsEnabled()).resolves.toEqual({ status: "subscription_failed" });
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

  describe("push prompt dismissal", () => {
    it("is not dismissed by default", async () => {
      const { hasDismissedPushPrompt } = await import("./push-client");
      expect(hasDismissedPushPrompt()).toBe(false);
    });

    it("persists across calls once marked dismissed, via localStorage", async () => {
      const { hasDismissedPushPrompt, markPushPromptDismissed } = await import("./push-client");
      markPushPromptDismissed();
      expect(hasDismissedPushPrompt()).toBe(true);
      expect(window.localStorage.getItem("newinmeter:push-prompt-dismissed")).toBe("1");
    });
  });
});
