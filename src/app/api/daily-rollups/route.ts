import { NextResponse } from "next/server";
import { loadDashboardDailyRollups } from "@/lib/dashboard-data";
import { requireConnectedSession } from "@/lib/auth/session";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireConnectedSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Connect a LiveMopay account first." },
      { status: auth.status }
    );
  }

  try {
    const identifier = getRateLimitIdentifier(auth.session.userId, "daily-rollups");
    const rateLimit = await enforceRateLimit(identifier);
    const rateHeaders = rateLimitHeaders(rateLimit);

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { message: "Rate limit exceeded. Please try again later." },
        { status: 429, headers: rateHeaders }
      );
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from")?.trim() || undefined;
    const to = searchParams.get("to")?.trim() || undefined;

    const rows = await loadDashboardDailyRollups(auth.session.accessToken, { from, to });
    return NextResponse.json({ rows }, { headers: rateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load daily rollups.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
