"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { IconTile, SettingsRow, Toggle } from "@/components/ui/settings";
import { isSyncStale } from "@/lib/sync-status";
import {
  ensurePushNotificationsEnabled,
  getPushPermissionState,
  hasActiveSubscription,
  unsubscribeFromPush,
  type PushPermissionState
} from "@/lib/push-client";

type BadgePermissionCardProps = {
  // The current connection's last sync time, so switching badges on can reflect
  // an already-stale state on the icon straight away.
  lastSyncedAt?: string | null;
};

// The "Home screen badge" switch. On iOS the icon badge is driven by
// notification permission + a delivered push, so turning it on requests
// permission and subscribes this device; turning it off unsubscribes and
// clears the badge. Rendered as a row inside the Preferences group. This is
// the device-level management/status surface for notifications -- Alerts'
// AlertRuleRow is the *first-ask* surface (see its own comments); both
// share the same underlying capability via ../../lib/push-client.
export function BadgePermissionCard({ lastSyncedAt }: BadgePermissionCardProps) {
  const [permission, setPermission] = useState<PushPermissionState>("unsupported");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const state = getPushPermissionState();
    setPermission(state);
    if (state === "unsupported") {
      return;
    }
    hasActiveSubscription()
      .then(setEnabled)
      .catch(() => setEnabled(false));
  }, []);

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
          const result = await ensurePushNotificationsEnabled();
          setPermission(getPushPermissionState());
          const ok = result.status === "granted";
          setEnabled(ok);
          if (ok) {
            await applyBadgeNow();
          }
        } else {
          await unsubscribeFromPush();
          if ("clearAppBadge" in navigator) {
            await navigator.clearAppBadge().catch(() => undefined);
          }
          setEnabled(false);
        }
      } catch (error) {
        console.error("Failed to update badge preference", error);
      } finally {
        setBusy(false);
      }
    },
    [busy, applyBadgeNow]
  );

  if (permission === "unsupported") {
    return null;
  }

  const description =
    permission === "denied"
      ? "Alerts still appear in NewinMeter, but notifications are blocked for this device. Re-enable them in your browser or device settings to change that."
      : enabled
        ? "Receiving NewinMeter alerts on this device."
        : "Alerts still appear in NewinMeter, but this device won't notify you outside the app.";

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
          checked={enabled}
          disabled={busy || permission === "denied"}
          onChange={handleToggle}
          label="Notifications"
        />
      }
    />
  );
}
