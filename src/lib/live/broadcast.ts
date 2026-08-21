import "server-only";

import { getSupabaseServiceRoleKey, getSupabaseUrl } from "../env";
import { logLiveError, logLiveWarning } from "./log";
import { liveMeterTopic, PULSES_CHANGED_EVENT } from "./realtime";

// Best-effort Realtime notification, sent AFTER pulses are persisted, telling
// the owner's browser "new pulse data exists -- refetch the overview". It is
// NOT the source of truth: the payload is minimal (accepted count + timestamp),
// carries no pulse rows, no device secret, no credentials. Uses Supabase's
// server-side broadcast HTTP endpoint with the service-role key, so there is no
// websocket to maintain on the server.
//
// This never throws: ingestion durability must not depend on Realtime. On any
// failure it logs a non-secret line and returns -- the client's fallback poll
// (or the next successful batch) recovers the missed update.
export async function broadcastPulsesChanged(ownerUserId: string, accepted: number): Promise<void> {
  try {
    const key = getSupabaseServiceRoleKey();
    const endpoint = `${getSupabaseUrl().replace(/\/$/, "")}/realtime/v1/api/broadcast`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [
          {
            topic: liveMeterTopic(ownerUserId),
            event: PULSES_CHANGED_EVENT,
            private: true,
            payload: { accepted, at: new Date().toISOString() }
          }
        ]
      })
    });

    if (!response.ok) {
      logLiveWarning("live_broadcast_failed", { status: response.status, accepted });
    }
  } catch (error) {
    logLiveError("live_broadcast_failed", error, { accepted });
  }
}
