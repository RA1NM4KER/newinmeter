import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { broadcastPulsesChanged } from "@/lib/live/broadcast";
import { logLiveError } from "@/lib/live/log";
import {
  authenticateDeviceKey,
  isLiveMeterEnabledForDevice,
  recordPulses,
  touchDeviceLastSeen
} from "@/lib/meter-devices";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BATCH_SIZE = 100;
// Reject pulses whose timestamp is implausibly far in the future -- that means
// the device clock is wrong, not that the data is legitimately buffered. Old
// (past) timestamps are always accepted: a device may upload buffered pulses
// long after connectivity returns.
const MAX_FUTURE_SKEW_MS = 48 * 60 * 60 * 1000;

const pulseSchema = z.object({
  seq: z.number().int().nonnegative().safe(),
  timestampMs: z.number().int().positive().safe(),
  uptimeMs: z.number().int().nonnegative().safe(),
  deltaMs: z.number().int().nonnegative().safe().nullable().default(null)
});

const requestSchema = z.object({
  bootId: z.string().uuid(),
  pulses: z.array(pulseSchema).min(1).max(MAX_BATCH_SIZE)
});

// Generic unauthorized response, identical for missing/malformed/unknown/
// disabled credentials so none of those cases is distinguishable.
function unauthorized() {
  return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
}

export async function POST(request: Request) {
  // Correlation id for this request, threaded through every log line so a
  // production failure can be traced end-to-end.
  const reqId = randomUUID().slice(0, 8);

  // Device authentication (not browser session): identity comes entirely from
  // the bearer key, never from the request body. A transient error here (e.g.
  // the DB is down) is a server fault, not "unauthorized" -- and its message is
  // redacted so the api_key_hash in the lookup URL never reaches logs.
  let device;
  try {
    device = await authenticateDeviceKey(request.headers.get("authorization"));
  } catch (error) {
    logLiveError("live_ingest_auth_error", error, { reqId });
    return NextResponse.json({ message: "Service temporarily unavailable." }, { status: 503 });
  }
  if (!device) {
    return unauthorized();
  }

  const rateHeaders: Record<string, string> = {};
  try {
    // Feature gate: the live-meter feature is a per-user opt-in (like
    // activities). Ingestion only proceeds if the device owner's flag is on.
    if (!(await isLiveMeterEnabledForDevice(device))) {
      return NextResponse.json({ message: "Live meter feature is not enabled for this account." }, { status: 403 });
    }

    // Rate limited per authenticated device id, using the dedicated meter policy.
    const rateLimit = await enforceRateLimit(getRateLimitIdentifier(device.id, "meter"), "meter");
    Object.assign(rateHeaders, rateLimitHeaders(rateLimit));
    if (!rateLimit.allowed) {
      return NextResponse.json({ message: "Rate limit exceeded." }, { status: 429, headers: rateHeaders });
    }
  } catch (error) {
    logLiveError("live_ingest_error", error, { reqId, deviceId: device.id });
    return NextResponse.json({ message: "Service temporarily unavailable." }, { status: 503, headers: rateHeaders });
  }

  let body: z.infer<typeof requestSchema>;
  try {
    body = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ message: "Invalid request body." }, { status: 400, headers: rateHeaders });
  }

  const futureCutoff = Date.now() + MAX_FUTURE_SKEW_MS;
  if (body.pulses.some((pulse) => pulse.timestampMs > futureCutoff)) {
    return NextResponse.json({ message: "Invalid pulse timestamp." }, { status: 400, headers: rateHeaders });
  }

  try {
    const result = await recordPulses(device.id, body.bootId, body.pulses);
    // Only stamp liveness after the pulses are safely stored.
    await touchDeviceLastSeen(device.id);

    // Best-effort Realtime nudge, only when this batch actually inserted new
    // rows (a duplicate-only retry changes nothing, so it stays silent). One
    // notification per accepted batch -- never one per pulse. broadcast never
    // throws, so a Realtime failure can't affect the already-durable response.
    if (result.accepted > 0) {
      // broadcast already swallows its own errors; the extra .catch guarantees
      // durability can never regress even if that changes.
      await broadcastPulsesChanged(device.ownerUserId, result.accepted).catch(() => {});
    }

    return NextResponse.json({ accepted: result.accepted, duplicates: result.duplicates }, { headers: rateHeaders });
  } catch (error) {
    logLiveError("live_ingest_db_error", error, { reqId, deviceId: device.id });
    return NextResponse.json({ message: "Failed to store pulses." }, { status: 500, headers: rateHeaders });
  }
}
