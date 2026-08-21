import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { logLiveError } from "@/lib/live/log";
import { DEFAULT_LIVE_WINDOW, isLiveWindow } from "@/lib/live/meter-calc";
import { loadLiveOverview } from "@/lib/live/meter";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";
import { getOrCreateUserPermissions } from "@/lib/user-roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  // Feature invisibility: a user without the permission gets the same 404 the
  // page itself returns, so the endpoint appears not to exist rather than
  // "forbidden". Never expose live data to a feature-disabled user.
  const permissions = await getOrCreateUserPermissions(session.userId);
  if (!permissions.liveMeterEnabled) {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }

  const identifier = getRateLimitIdentifier(session.userId, "live");
  const rateLimit = await enforceRateLimit(identifier, "live");
  const headers = rateLimitHeaders(rateLimit);
  if (!rateLimit.allowed) {
    return NextResponse.json({ message: "Rate limit exceeded." }, { status: 429, headers });
  }

  // Strict window validation. Missing -> default; anything not in the allowed
  // set -> 400 (never silently coerced).
  const rawWindow = new URL(request.url).searchParams.get("window");
  if (rawWindow !== null && !isLiveWindow(rawWindow)) {
    return NextResponse.json({ message: "Invalid window." }, { status: 400, headers });
  }
  const window = rawWindow ?? DEFAULT_LIVE_WINDOW;

  const reqId = randomUUID().slice(0, 8);
  try {
    // Identity comes only from the session -- the device/connection are
    // resolved server-side from session.userId, never from the request.
    const overview = await loadLiveOverview(session.userId, window);
    return NextResponse.json(overview, { headers });
  } catch (error) {
    logLiveError("live_overview_error", error, { reqId, window });
    return NextResponse.json({ message: "Failed to load live overview." }, { status: 500, headers });
  }
}
