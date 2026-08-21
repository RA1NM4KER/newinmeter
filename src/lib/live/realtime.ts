// Shared Realtime constants for the Live feature. Pure (no server-only), so the
// server broadcaster and the browser subscriber agree on one topic/event
// naming, and the topic is always derived from a user id (never free-form).

export const PULSES_CHANGED_EVENT = "pulses_changed";

// Slow safety-net poll for the Live overview. Realtime broadcast is the normal
// update path; this only recovers a missed event or a dropped websocket (down
// from the old ~5s poll).
export const LIVE_FALLBACK_POLL_MS = 60_000;

// Private per-user topic. A user only ever builds their OWN topic from their
// own id in the client, and the realtime.messages RLS policy independently
// enforces that a subscriber can receive only the topic matching auth.uid()
// (see the realtime-authorization migration) -- so this string being
// predictable is not a security boundary on its own.
export function liveMeterTopic(userId: string): string {
  return `live-meter:${userId}`;
}
