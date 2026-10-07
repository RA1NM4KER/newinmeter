import "server-only";

import { adminSupabaseRequest } from "../supabase-rest";

export type PassiveComponent =
  | "cron:stale-check"
  | "cron:reset-demo"
  | "cron:cold-storage"
  | "alerts:fresh"
  | "alerts:delayed"
  | "ai:requests";
export type PassiveOutcome = "success" | "failure" | "skipped";
export const PASSIVE_SAMPLE_MS = 10 * 60_000;

// This is an opportunistic, per-instance write reduction, not a global quota.
// Separate outcome rows preserve a failure even when another request succeeds.
// Keys contain no user identity and the map is bounded by the component union.
const lastAttempt = new Map<string, number>();

export async function recordPassiveOutcome(
  component: PassiveComponent,
  outcome: PassiveOutcome,
  startedAt: number,
  evaluatedCount?: number
): Promise<void> {
  const now = Date.now();
  const key = `passive:${component}:${outcome}`;
  const previous = lastAttempt.get(key);
  if (!component.startsWith("cron:") && previous !== undefined && now >= previous && now - previous < PASSIVE_SAMPLE_MS)
    return;
  // Reserve before awaiting so concurrent evaluations on this instance cannot
  // all write. Failed telemetry attempts also back off, preventing retry storms.
  if (!component.startsWith("cron:")) lastAttempt.set(key, now);
  const timestamp = new Date(now).toISOString();
  const durationMs = Number.isFinite(startedAt) ? Math.max(0, Math.round(now - startedAt)) : 0;
  try {
    await adminSupabaseRequest(
      "POST",
      "/system_health_state?on_conflict=component",
      {
        component: key,
        status: outcome === "failure" ? "warning" : "healthy",
        last_checked_at: timestamp,
        last_success_at: outcome === "success" ? timestamp : null,
        // Explicit fields only: no exceptions, prompts, responses or identities.
        details: {
          durationMs,
          ...(Number.isFinite(evaluatedCount) ? { evaluatedCount: Math.max(0, Math.floor(evaluatedCount!)) } : {})
        },
        updated_at: timestamp
      },
      "resolution=merge-duplicates,return=minimal",
      AbortSignal.timeout(1500)
    );
  } catch {
    // Observability must never change a job, alert or assistant outcome.
    console.warn("passive_health_write_unavailable", { component });
  }
}
