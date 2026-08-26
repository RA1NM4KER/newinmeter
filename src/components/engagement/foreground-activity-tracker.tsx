"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser-client";

// Long enough that Strict Mode, route transitions and visibility churn cannot
// produce write spam; short enough that a real later foreground return updates
// last_seen_at usefully. The database primary key still guarantees one row/day.
export const FOREGROUND_ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;

function storageKey(userId: string) {
  return `newinmeter:foreground-activity:${userId}`;
}

export function ForegroundActivityTracker({ userId }: { userId: string }) {
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const inFlightRef = useRef(false);

  const recordVisibleActivity = useCallback(async () => {
    if (document.visibilityState !== "visible" || inFlightRef.current) return;

    const now = Date.now();
    const key = storageKey(userId);
    const previous = Number(sessionStorage.getItem(key) ?? 0);
    if (Number.isFinite(previous) && now - previous < FOREGROUND_ACTIVITY_THROTTLE_MS) return;

    // Set before awaiting so double effects and rapid visibility events share
    // the same throttle window. A failed request clears it for a later retry.
    sessionStorage.setItem(key, String(now));
    inFlightRef.current = true;
    const { error } = await supabase.rpc("record_user_activity");
    inFlightRef.current = false;

    if (error) {
      if (sessionStorage.getItem(key) === String(now)) sessionStorage.removeItem(key);
      console.warn("newinmeter_foreground_activity_failed");
    }
  }, [supabase, userId]);

  useEffect(() => {
    void recordVisibleActivity();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void recordVisibleActivity();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [recordVisibleActivity]);

  return null;
}
