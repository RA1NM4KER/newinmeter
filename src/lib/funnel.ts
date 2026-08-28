import "server-only";

import { adminSupabaseRequest } from "./supabase-rest";

// Keep this list in sync with the check constraint in
// 20260828100000_onboarding_funnel.sql. Deliberately small and named after
// product steps, not routes -- there is no page-view-by-page-view tracking
// here, only these specific onboarding milestones.
export const FUNNEL_EVENT_TYPES = [
  "login_page_viewed",
  "public_demo_started",
  "demo_reached",
  "sign_in_started",
  "sign_in_completed",
  "connect_screen_viewed",
  "connect_attempted",
  "connect_invalid_credentials",
  "connect_succeeded",
  "initial_sync_succeeded",
  "initial_sync_failed"
] as const;

export type FunnelEventType = (typeof FUNNEL_EVENT_TYPES)[number];

// Fire-and-forget aggregate counter. Never throws -- a tracking failure must
// never surface to a user or block the onboarding flow it's measuring. No
// user id, session id, IP, or free text is ever passed here or stored by
// the RPC it calls.
export async function recordFunnelEvent(eventType: FunnelEventType): Promise<void> {
  try {
    await adminSupabaseRequest("POST", "/rpc/record_funnel_event", { p_event_type: eventType }, "return=minimal");
  } catch (error) {
    console.error("funnel_event_tracking_failed", eventType, error instanceof Error ? error.message : "unknown_error");
  }
}
