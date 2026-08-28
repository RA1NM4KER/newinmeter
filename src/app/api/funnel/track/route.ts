import { NextResponse } from "next/server";
import { z } from "zod";
import { FUNNEL_EVENT_TYPES, recordFunnelEvent } from "@/lib/funnel";
import { enforceRateLimit, getRateLimitIdentifier, getTrustedRequestIp, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Only milestones whose true outcome is only known client-side use this
// endpoint -- everything else (page views, connect attempts/results) is
// recorded directly from the server route/page that already handles that
// step. See src/lib/funnel.ts. Sign-in itself is a direct browser->Supabase
// call our server never sees; the initial sync's pass/fail is decided by
// ConnectForm reading /api/sync's response, not by /api/sync itself (which
// also serves ordinary resyncs and has no "this is onboarding" context).
const CLIENT_TRACKABLE_EVENTS = new Set([
  "sign_in_started",
  "sign_in_completed",
  "initial_sync_succeeded",
  "initial_sync_failed"
]);

const trackRequestSchema = z.object({
  event: z.enum(FUNNEL_EVENT_TYPES)
});

// Fire-and-forget by design: the client never awaits a meaningful response,
// and a failure here must never be visible to a user or block navigation.
export async function POST(request: Request) {
  const identifier = getRateLimitIdentifier(getTrustedRequestIp(request), "funnel-track");
  const rateLimit = await enforceRateLimit(identifier, "funnelTrack");
  const rateHeaders = rateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    return new NextResponse(null, { status: 429, headers: rateHeaders });
  }

  const parsed = trackRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !CLIENT_TRACKABLE_EVENTS.has(parsed.data.event)) {
    return new NextResponse(null, { status: 204, headers: rateHeaders });
  }

  await recordFunnelEvent(parsed.data.event);
  return new NextResponse(null, { status: 204, headers: rateHeaders });
}
