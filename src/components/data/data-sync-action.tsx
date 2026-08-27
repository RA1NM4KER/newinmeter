"use client";

import { useEffect } from "react";
import { SyncButton } from "@/components/ui/sync-button";
import { demoCapability } from "@/lib/demo/capabilities";
import { isSyncStale } from "@/lib/sync-status";

type DataSyncActionProps = {
  iconOnly?: boolean;
  lastSyncedAt?: string | null;
  // True while the real lastSyncedAt is still unknown (first load, no cached
  // data yet) -- distinct from lastSyncedAt genuinely being null/undefined
  // because a connected account has never run a sync, which should nudge.
  loading?: boolean;
  isDemo?: boolean;
};

export function DataSyncAction({ iconOnly = false, lastSyncedAt, loading = false, isDemo = false }: DataSyncActionProps) {
  const handleSyncSuccess = async () => {
    window.location.reload();
  };

  // Mirrors the in-app nudge dot onto the installed PWA's home-screen icon,
  // using the exact same lastSyncedAt already fetched for this page -- no
  // separate endpoint, so it can't disagree with the visible dot. Rendering
  // on two pages means two calls in the same session; setAppBadge/
  // clearAppBadge are idempotent, so that's harmless. Polled on an interval,
  // not just on lastSyncedAt change, since staleness is time-relative and
  // can flip from false to true with the tab sitting open and no new data.
  useEffect(() => {
    if (loading || typeof navigator === "undefined" || !("setAppBadge" in navigator)) {
      return;
    }

    // iOS ties badge *display* to notification permission: setAppBadge()
    // resolves without error but nothing shows on the Home Screen icon until
    // the user has granted permission (see the Enable badges control in
    // Settings). No point calling it before then. On platforms without the
    // Notification API (older desktop PWAs) we fall through and badge anyway.
    const badgesAllowed = typeof Notification === "undefined" || Notification.permission === "granted";
    if (!badgesAllowed) {
      return;
    }

    const updateBadge = () => {
      // Explicit count of 1: iOS renders nothing for a no-arg setAppBadge().
      const op = isSyncStale(lastSyncedAt) ? navigator.setAppBadge(1) : navigator.clearAppBadge();
      op?.catch((error) => {
        console.error("Failed to update app badge", error);
      });
    };

    updateBadge();
    const intervalId = setInterval(updateBadge, 15 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [lastSyncedAt, loading]);

  // Always rendered as the filter bar's leftControls, so it always sits on
  // the bar's dark teal background -- no other caller in this codebase.
  return (
    <SyncButton
      disabled={isDemo}
      disabledReason={isDemo ? demoCapability("sync").reason : undefined}
      iconOnly={iconOnly}
      onSuccess={handleSyncSuccess}
      tone="dark"
      showNudge={!isDemo && !loading && isSyncStale(lastSyncedAt)}
    />
  );
}
