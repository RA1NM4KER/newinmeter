"use client";

import { useState } from "react";
import { BellOff, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeviceNotifications } from "@/components/layout/push-notification-provider";
import { usePwaInstall } from "@/components/pwa/pwa-install-provider";
import { describeSubscriptionFailure } from "@/lib/push-client";

// Device push is a whole-device state, not a per-alert one -- this is the
// single place that explains it and offers the fix, instead of every
// enabled AlertRuleRow repeating its own copy of the same fact (the old
// behaviour this replaces). Renders nothing once this device is actually
// subscribed, or while the initial/resume check is still in flight (never
// claim a confident OFF before that's known).
export function DeviceNotificationStatus() {
  const { browserPermission, subscriptionActive, checking, enableDeviceNotifications } = useDeviceNotifications();
  const { isIos, isMobile, isStandalone, openInstallGuide } = usePwaInstall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (checking || subscriptionActive) {
    return null;
  }

  // iOS Safari before Home Screen install has no Web Push at all, so
  // getPushPermissionState() honestly reports "unsupported" here -- but
  // that's not the whole truth for the user: installing turns this into a
  // push-capable device. Takes priority over every other branch below
  // (including a stray "denied" iOS can sometimes report) because the fix
  // is the same regardless: add to Home Screen first.
  if (isIos && !isStandalone) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-canvas px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2.5">
          <Smartphone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          <div className="min-w-0">
            <p className="text-[0.8125rem] text-ink">Get alerts on your phone</p>
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">
              Add NewinMeter to your Home Screen, then turn on notifications so alerts can reach you even when the
              app is closed.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={openInstallGuide} className="shrink-0">
          Set up phone alerts
        </Button>
      </div>
    );
  }

  async function handleTurnOn() {
    setBusy(true);
    setError(null);
    try {
      // Covers both real gaps this section can fix: permission still
      // "default" (requests it, then subscribes) and permission "granted"
      // but this device unsubscribed (subscribes directly, no native
      // prompt). "denied" and "unsupported" never reach this handler at
      // all -- see the button's own guard below -- so this never retries
      // Notification.requestPermission() against a browser that already
      // said no.
      const result = await enableDeviceNotifications();
      if (result.status === "subscription_failed") {
        setError(describeSubscriptionFailure(result.reason));
      }
      // A "denied" result here (permission was "default" and the user just
      // said no to the native prompt) needs no separate message -- this
      // component re-renders into the "blocked" copy below the instant
      // browserPermission updates.
    } finally {
      setBusy(false);
    }
  }

  const canRetryHere = browserPermission === "default" || browserPermission === "granted";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-canvas px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <BellOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        <div className="min-w-0">
          <p className="text-[0.8125rem] text-ink">
            {browserPermission === "denied"
              ? "Notifications are blocked for this device."
              : browserPermission === "unsupported"
                ? "Push notifications aren't available on this device."
                : isMobile
                  ? "Phone notifications are off"
                  : "Notifications are off on this device."}
          </p>
          <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted">
            {browserPermission === "denied"
              ? "Alerts will still appear in NewinMeter. Allow notifications for this site in your browser or device settings to turn them back on."
              : browserPermission === "unsupported"
                ? "Alerts will still appear in NewinMeter."
                : isMobile
                  ? "Your alerts are active in NewinMeter, but this phone can't receive them yet."
                  : "Your alerts are active in NewinMeter, but this device can't receive them yet."}
          </p>
          {error ? <p className="mt-1 text-[0.8125rem] text-red-600">{error}</p> : null}
        </div>
      </div>
      {canRetryHere ? (
        <Button variant="secondary" size="sm" onClick={() => void handleTurnOn()} disabled={busy} className="shrink-0">
          {busy ? "Turning on…" : "Turn on notifications"}
        </Button>
      ) : null}
    </div>
  );
}
