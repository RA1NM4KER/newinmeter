"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { IconTile, SettingsRow, Toggle } from "@/components/ui/settings";
import { isSyncStale } from "@/lib/sync-status";

type BadgeState = "unknown" | "unsupported" | "default" | "granted" | "denied";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type BadgePermissionCardProps = {
  // The current connection's last sync time, so switching badges on can reflect
  // an already-stale state on the icon straight away.
  lastSyncedAt?: string | null;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

// serviceWorker.ready never resolves when no worker will ever activate (e.g.
// localhost, where the PWA registrar unregisters the SW), which would leave the
// toggle stuck in its busy state. Race it against a timeout so the control
// always settles instead of hanging.
async function getReadyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    return null;
  }
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
  ]);
}

async function subscribeToPush(): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  const registration = await getReadyRegistration();
  if (!registration) {
    return false;
  }
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    }));

  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON())
  });

  return response.ok;
}

async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return;
  }

  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => undefined);
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint })
  }).catch(() => undefined);
}

async function hasActiveSubscription(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  return Boolean(await registration.pushManager.getSubscription());
}

// The "Home screen badge" switch. On iOS the icon badge is driven by
// notification permission + a delivered push, so turning it on requests
// permission and subscribes this device; turning it off unsubscribes and
// clears the badge. Rendered as a row inside the Preferences group.
export function BadgePermissionCard({ lastSyncedAt }: BadgePermissionCardProps) {
  const [permission, setPermission] = useState<BadgeState>("unknown");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("setAppBadge" in navigator) || typeof Notification === "undefined") {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as BadgeState);
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
          const granted = permission === "granted" ? "granted" : await Notification.requestPermission();
          setPermission(granted as BadgeState);
          if (granted !== "granted") {
            setEnabled(false);
            return;
          }
          const ok = await subscribeToPush();
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
    [busy, permission, applyBadgeNow]
  );

  if (permission === "unsupported") {
    return null;
  }

  const description =
    permission === "denied"
      ? "Notifications are blocked. Re-enable them for NewinMeter in your browser or device settings."
      : "Get notified on this device for alerts you set up, and when your data needs attention.";

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
