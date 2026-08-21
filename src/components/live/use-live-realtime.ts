"use client";

import { useEffect } from "react";
import { createLiveSubscription, type LiveRealtimeClient } from "@/lib/live/subscription";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser-client";

// Thin React wrapper around createLiveSubscription (which holds the testable
// lifecycle logic). Subscribes to the authenticated user's PRIVATE Live channel
// and calls onPulsesChanged when new pulse data is persisted -- an invalidation
// nudge only; the caller refetches the authoritative overview API.
//
// onPulsesChanged must be stable (wrap in useCallback) to avoid resubscribing.
export function useLiveRealtime(userId: string | null | undefined, onPulsesChanged: () => void): void {
  useEffect(() => {
    if (!userId) {
      return;
    }
    const client = createSupabaseBrowserClient() as unknown as LiveRealtimeClient;
    return createLiveSubscription(client, userId, onPulsesChanged);
  }, [userId, onPulsesChanged]);
}
