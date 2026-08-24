"use client";

import { useCallback, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconTile, SettingsRow, Toggle } from "@/components/ui/settings";
import { isSyncStale } from "@/lib/sync-status";
import { useDeviceNotifications } from "@/components/layout/push-notification-provider";
import { usePwaInstall } from "@/components/pwa/pwa-install-provider";

type BadgePermissionCardProps = {
  // The current connection's last sync time, so switching badges on can reflect
  // an already-stale state on the icon straight away.
  lastSyncedAt?: string | null;
};

// General's device-notifications management row -- always shows the real
// subscriptionActive state from the shared PushNotificationProvider (never
// derives ON/OFF from browserPermission alone; see that module's own
// comment on why that distinction is the whole point of this refactor).
// This is the one place a user can explicitly turn this device's push back
// on after having turned it off, regardless of whatever Alerts' own
// dismissal flag currently says.
export function BadgePermissionCard({ lastSyncedAt }: BadgePermissionCardProps) {
  const { browserPermission, subscriptionActive, checking, enableDeviceNotifications, disableDeviceNotifications } =
    useDeviceNotifications();
  const { isIos, isStandalone, openInstallGuide } = usePwaInstall();
  const [busy, setBusy] = useState(false);

  const applyBadgeNow = useCallback(async () => {
    if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) {
      return;
    }
    try {
      if (isSyncStale(lastSyncedAt)) {
        await navigator.setAppBadge(1);
      } else {
        await navigator.clearAppBadge();
      }
    } catch (error) {
      console.error("Failed to set app badge", error);
    }
  }, [lastSyncedAt]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (busy) return;
      setBusy(true);
      try {
        if (next) {
          const result = await enableDeviceNotifications();
          if (result.status === "granted") {
            await applyBadgeNow();
          }
        } else {
          await disableDeviceNotifications();
          if ("clearAppBadge" in navigator) {
            await navigator.clearAppBadge().catch(() => undefined);
          }
        }
      } catch (error) {
        console.error("Failed to update notification preference", error);
      } finally {
        setBusy(false);
      }
    },
    [busy, enableDeviceNotifications, disableDeviceNotifications, applyBadgeNow]
  );

  if (browserPermission === "unsupported") {
    // iOS Safari before Home Screen install always reports "unsupported"
    // here (no Web Push API exists yet) -- that's not the same as "this
    // device can never do this", so it gets an actionable row instead of
    // silently disappearing. Any other genuinely unsupported platform still
    // renders nothing, same as before.
    if (isIos && !isStandalone) {
      return (
        <SettingsRow
          leading={
            <IconTile>
              <Bell size={18} strokeWidth={2} />
            </IconTile>
          }
          title="Notifications"
          description="Add NewinMeter to your Home Screen to enable phone notifications."
          control={
            <Button variant="secondary" size="sm" onClick={openInstallGuide}>
              Set up
            </Button>
          }
        />
      );
    }
    return null;
  }

  // "ON" is a statement about whether NewinMeter is configured to push to
  // this device (an active, server-registered subscription exists) -- not
  // a claim about the OS-level notification switch. The device's own
  // settings can still block delivery even while this shows ON (most
  // notably: iOS doesn't reliably expose its Settings -> NewinMeter ->
  // Notifications toggle to the browser), which the secondary sentence on
  // ON exists to make explicit rather than implying certainty NewinMeter
  // doesn't have. "denied" is only shown when the browser itself honestly
  // reports it (true on desktop/Android; not guaranteed on iOS).
  const description =
    browserPermission === "denied"
      ? "Notifications are blocked for this device. Alerts still appear in NewinMeter."
      : subscriptionActive
        ? "NewinMeter notifications are enabled for this device. Your device settings can still block delivery."
        : "NewinMeter won't send push notifications to this device. Alerts still appear in the app.";

  return (
    <SettingsRow
      leading={
        <IconTile>
          <Bell size={18} strokeWidth={2} />
        </IconTile>
      }
      title="Notifications"
      description={description}
      control={
        <Toggle
          checked={subscriptionActive}
          disabled={busy || checking || browserPermission === "denied"}
          onChange={handleToggle}
          label="Notifications"
        />
      }
    />
  );
}
