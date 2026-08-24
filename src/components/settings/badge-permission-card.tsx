"use client";

import { useCallback, useState } from "react";
import { Bell } from "lucide-react";
import { IconTile, SettingsRow, Toggle } from "@/components/ui/settings";
import { isSyncStale } from "@/lib/sync-status";
import { useDeviceNotifications } from "@/components/layout/push-notification-provider";

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
    return null;
  }

  const description =
    browserPermission === "denied"
      ? "Notifications are blocked by this device or browser. Alerts still appear in NewinMeter."
      : subscriptionActive
        ? "Receiving NewinMeter notifications on this device."
        : "Push notifications are off on this device. Alerts still appear in NewinMeter.";

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
