"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  clearDeviceNotificationsDismissed,
  ensurePushNotificationsEnabled,
  getPushPermissionState,
  hasActiveSubscription,
  repairExistingSubscription,
  unsubscribeFromPush,
  type PushEnableResult,
  type PushPermissionState
} from "@/lib/push-client";
import { demoCapabilityBlocked } from "@/lib/demo/capabilities";

type DeviceNotificationsState = {
  // Is NewinMeter allowed by the browser/OS to send notifications at all?
  browserPermission: PushPermissionState;
  // "Is NewinMeter push enabled for this browser/device?" -- ON means a
  // browser PushSubscription exists AND NewinMeter's server has that exact
  // endpoint registered; OFF means it doesn't. Never derived from
  // `browserPermission === "granted"` alone -- a user can explicitly
  // unsubscribe this device (General OFF) while the browser still reports
  // permission granted, and enabling an alert must not silently
  // re-subscribe a device the user deliberately turned off. Nor is it just
  // "a browser PushSubscription object exists" -- a browser can hold a
  // live subscription the server no longer has a row for (deleted row,
  // rotated VAPID key), and reporting ON from the object alone would claim
  // reachability the server can't actually deliver on.
  //
  // Deliberately NOT a claim about the OS/system notification switch.
  // "ON" means "NewinMeter is configured to send this device push" -- the
  // OS can still suppress delivery afterward (most notably: iOS Safari/
  // home-screen PWA does not reliably expose the iPhone Settings ->
  // NewinMeter -> Notifications toggle through Notification.permission, so
  // General can legitimately show ON even if that system switch is off).
  // That's an accepted, truthful limitation under this definition, not a
  // bug -- see the resume-refresh effect below for what it does and does
  // NOT promise about detecting that toggle.
  subscriptionActive: boolean;
  // True during the initial check and any explicit refresh -- callers use
  // this to avoid rendering a confident ON/OFF before the real browser
  // subscription state is known.
  checking: boolean;
  // The only two mutators. Both callers (General's toggle, Alerts' "Turn on
  // notifications") go through these rather than touching push-client.ts's
  // primitives directly, so this provider's state is always the single
  // source of truth -- General reflects an Alerts-driven enable
  // immediately, and vice versa, with no separate fetch/cache per
  // component.
  enableDeviceNotifications: () => Promise<PushEnableResult>;
  disableDeviceNotifications: () => Promise<void>;
  refreshDeviceNotificationState: () => Promise<void>;
};

const DeviceNotificationsContext = createContext<DeviceNotificationsState | null>(null);

// visibilitychange and focus (and occasionally pageshow) commonly all fire
// for the same single "user came back to the app" moment -- this window
// coalesces them into one real refresh instead of two or three back to back.
const RESUME_COALESCE_WINDOW_MS = 500;

// One logical owner of "does this device receive NewinMeter push" for the
// whole authenticated session. Settings mounts General, Data & Sync, Alerts
// and Account all at once (see settings-page-client.tsx's own comment on
// why), so General's BadgePermissionCard and Alerts' AlertRuleRow are both
// live simultaneously, not sequential page loads -- exactly the situation
// NotificationProvider already solved for the header bell, same reasoning
// applies here.
export function PushNotificationProvider({ children, isDemo = false }: { children: ReactNode; isDemo?: boolean }) {
  const [browserPermission, setBrowserPermission] = useState<PushPermissionState>("unsupported");
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [checking, setChecking] = useState(true);
  const loadingRef = useRef(false);
  const lastResumeTriggerRef = useRef(0);

  const refreshDeviceNotificationState = useCallback(async () => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setChecking(true);
    try {
      if (demoCapabilityBlocked(isDemo, "pushSubscription")) {
        setBrowserPermission("unsupported");
        setSubscriptionActive(false);
        return;
      }
      const permission = getPushPermissionState();
      setBrowserPermission(permission);

      if (permission === "unsupported" || permission === "denied") {
        // Covers any platform where the browser itself explicitly reports
        // permission as "denied" (desktop Chrome/Firefox/Edge, Android
        // Chrome, and iOS when it does happen to report it) -- a
        // subscription can't be usable when the browser says notifications
        // are blocked, so this is reported OFF without even checking.
        // Deliberately does NOT unsubscribe/delete any existing
        // subscription: "denied" from the browser isn't necessarily the
        // user changing their NewinMeter preference, and there's nothing
        // unsafe about a leftover subscription sitting unused server-side.
        // NOTE: this branch is correct wherever the browser DOES expose an
        // honest "denied", but iOS Safari/home-screen PWA does not
        // reliably enter it just because the user turned notifications off
        // in iPhone Settings -> NewinMeter -> Notifications --
        // Notification.permission there can keep reading "granted"
        // regardless of that system toggle. This is not something
        // NewinMeter can detect from here; see subscriptionActive's own
        // doc comment for the (deliberately more modest) promise General
        // ON/OFF actually makes.
        setSubscriptionActive(false);
        return;
      }

      const hasBrowserSubscription = await hasActiveSubscription();
      if (!hasBrowserSubscription) {
        setSubscriptionActive(false);
        return;
      }

      // A browser PushSubscription existing is necessary but not
      // sufficient -- confirm (repair, if needed) the server's own
      // registration for this exact endpoint before reporting ON. Awaited,
      // not fire-and-forget: ON is a claim that the server can currently
      // reach this device, so it must reflect what the server just
      // confirmed, not just what the browser locally remembers. On
      // failure, subscriptionActive stays false -- honest about "we just
      // tried to confirm this device is reachable and couldn't", not
      // optimistic about state we haven't actually verified. This can
      // read as a transient OFF on a real network hiccup (the next
      // refresh/repair attempt corrects it), which is the accepted
      // trade-off for never showing a false ON. No UI flicker results:
      // this all happens within the same initial `checking` pass, before
      // subscriptionActive is ever set true.
      const registered = await repairExistingSubscription();
      setSubscriptionActive(registered);
      if (registered) {
        clearDeviceNotificationsDismissed();
      }
    } finally {
      setChecking(false);
      loadingRef.current = false;
    }
  }, [isDemo]);

  useEffect(() => {
    void refreshDeviceNotificationState();
  }, [refreshDeviceNotificationState]);

  // Re-check on resume -- the app never reloads when backgrounded and
  // foregrounded again (true of any tab, and especially a PWA the user
  // hops out of and back into), so without this, browserPermission/
  // subscriptionActive would stay whatever they were at initial mount for
  // the rest of the session. Two things this genuinely buys, regardless of
  // platform: (1) re-confirming/repairing the server's registration for an
  // existing browser subscription -- worth doing any time the app was
  // backgrounded a while; (2) picking up a real Notification.permission
  // change on platforms that actually expose one (desktop, Android). It is
  // NOT a reliable way to detect the user disabling notifications for
  // NewinMeter via iPhone Settings -> NewinMeter -> Notifications -- iOS
  // Safari/home-screen PWA can keep reporting the same
  // Notification.permission value regardless of that system toggle, so
  // this refresh makes no promise that General flips to OFF/blocked when
  // that happens. `visibilitychange` is the primary signal; `focus` and
  // `pageshow` are included as belt-and-braces for contexts where it
  // doesn't fire.
  useEffect(() => {
    const handleResume = () => {
      const now = Date.now();
      // visibilitychange and focus commonly both fire for the same real
      // "user came back to the app" moment -- without this, that single
      // moment would trigger two full refresh passes back to back. The
      // in-flight guard inside refreshDeviceNotificationState already
      // prevents a second refresh from running *concurrently* with one
      // still in flight, but two events arriving a few ms apart (first
      // one already resolved) would otherwise still trigger two separate
      // real checks. This time-based coalescing catches that case too.
      if (now - lastResumeTriggerRef.current < RESUME_COALESCE_WINDOW_MS) {
        return;
      }
      lastResumeTriggerRef.current = now;
      void refreshDeviceNotificationState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        handleResume();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleResume);
      window.removeEventListener("pageshow", handleResume);
    };
  }, [refreshDeviceNotificationState]);

  // The explicit "turn this device's push on" action -- General's toggle,
  // or Alerts' "Turn on notifications" dialog button. May call
  // Notification.requestPermission() (via ensurePushNotificationsEnabled)
  // when permission is still "default" -- always fine here because both
  // callers only ever invoke this from a direct user click.
  const enableDeviceNotifications = useCallback(async (): Promise<PushEnableResult> => {
    if (demoCapabilityBlocked(isDemo, "pushSubscription")) return { status: "unsupported" };
    const result = await ensurePushNotificationsEnabled();
    setBrowserPermission(getPushPermissionState());
    setSubscriptionActive(result.status === "granted");
    if (result.status === "granted") {
      clearDeviceNotificationsDismissed();
    }
    return result;
  }, [isDemo]);

  // The explicit "turn this device's push off" action -- General's toggle
  // only (Alerts never disables push, only chooses not to enable it).
  // Never touches browserPermission: there is no API to revoke browser/OS
  // permission, and the product model doesn't want to imply this did
  // anything to it -- the user only told NewinMeter not to use it here.
  const disableDeviceNotifications = useCallback(async () => {
    if (demoCapabilityBlocked(isDemo, "pushSubscription")) return;
    await unsubscribeFromPush();
    setSubscriptionActive(false);
  }, [isDemo]);

  const value = useMemo<DeviceNotificationsState>(
    () => ({
      browserPermission,
      subscriptionActive,
      checking,
      enableDeviceNotifications,
      disableDeviceNotifications,
      refreshDeviceNotificationState
    }),
    [
      browserPermission,
      subscriptionActive,
      checking,
      enableDeviceNotifications,
      disableDeviceNotifications,
      refreshDeviceNotificationState
    ]
  );

  return <DeviceNotificationsContext.Provider value={value}>{children}</DeviceNotificationsContext.Provider>;
}

export function useDeviceNotifications(): DeviceNotificationsState {
  const context = useContext(DeviceNotificationsContext);
  if (!context) {
    throw new Error("useDeviceNotifications must be used within a PushNotificationProvider");
  }
  return context;
}
