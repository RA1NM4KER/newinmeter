// Browser-side counterpart to src/lib/funnel.ts. Only used for the two
// milestones that genuinely happen client-side before any of our own
// server routes are involved (the Supabase sign-in calls themselves go
// straight from the browser to Supabase, not through our backend).
// Deliberately fire-and-forget: never awaited by callers, never throws,
// never blocks or delays the actual sign-in flow it's measuring.
export function trackFunnelEvent(
  event: "sign_in_started" | "sign_in_completed" | "initial_sync_succeeded" | "initial_sync_failed"
): void {
  try {
    void fetch("/api/funnel/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true
    }).catch(() => {});
  } catch {
    // Best-effort only.
  }
}
