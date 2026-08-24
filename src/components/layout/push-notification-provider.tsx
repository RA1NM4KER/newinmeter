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

type DeviceNotificationsState = {
  // Is NewinMeter allowed by the browser/OS to send notifications at all?
  browserPermission: PushPermissionState;
  // Does THIS DEVICE currently have an active NewinMeter push subscription
  // THAT THE SERVER CAN ACTUALLY REACH? Three things have to be true:
  // browser permission allows it, a browser PushSubscription exists, and
  // NewinMeter's server has that exact endpoint registered in
  // push_subscriptions. This -- never `browserPermission === "granted"`,
  // and never just "a browser PushSubscription object exists" -- is what
  // General's ON/OFF switch and Alerts' "does this device need asking"
  // check both read. Two bugs this fixes: (1) permission can be "granted"
  // while the user has explicitly unsubscribed this device (General OFF);
  // treating those as the same thing meant enabling an alert silently
  // re-subscribed a device the user had deliberately turned off. (2) a
  // browser can hold a live PushSubscription object the server no longer
  // has a row for (row deleted, VAPID rotated, etc.) -- reporting ON from
  // the browser object alone would show a device as reachable when the
  // server literally cannot send it anything.
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

// One logical owner of "does this device receive NewinMeter push" for the
// whole authenticated session. Settings mounts General, Data & Sync, Alerts
// and Account all at once (see settings-page-client.tsx's own comment on
// why), so General's BadgePermissionCard and Alerts' AlertRuleRow are both
// live simultaneously, not sequential page loads -- exactly the situation
// NotificationProvider already solved for the header bell, same reasoning
// applies here.
export function PushNotificationProvider({ children }: { children: ReactNode }) {
  const [browserPermission, setBrowserPermission] = useState<PushPermissionState>("unsupported");
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [checking, setChecking] = useState(true);
  const loadingRef = useRef(false);

  const refreshDeviceNotificationState = useCallback(async () => {
    if (loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    setChecking(true);
    try {
      const permission = getPushPermissionState();
      setBrowserPermission(permission);

      if (permission === "unsupported") {
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
  }, []);

  useEffect(() => {
    void refreshDeviceNotificationState();
  }, [refreshDeviceNotificationState]);

  // The explicit "turn this device's push on" action -- General's toggle,
  // or Alerts' "Turn on notifications" dialog button. May call
  // Notification.requestPermission() (via ensurePushNotificationsEnabled)
  // when permission is still "default" -- always fine here because both
  // callers only ever invoke this from a direct user click.
  const enableDeviceNotifications = useCallback(async (): Promise<PushEnableResult> => {
    const result = await ensurePushNotificationsEnabled();
    setBrowserPermission(getPushPermissionState());
    setSubscriptionActive(result.status === "granted");
    if (result.status === "granted") {
      clearDeviceNotificationsDismissed();
    }
    return result;
  }, []);

  // The explicit "turn this device's push off" action -- General's toggle
  // only (Alerts never disables push, only chooses not to enable it).
  // Never touches browserPermission: there is no API to revoke browser/OS
  // permission, and the product model doesn't want to imply this did
  // anything to it -- the user only told NewinMeter not to use it here.
  const disableDeviceNotifications = useCallback(async () => {
    await unsubscribeFromPush();
    setSubscriptionActive(false);
  }, []);

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
