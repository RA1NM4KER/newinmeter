import { NextResponse } from "next/server";
import { loadActivityReport } from "@/lib/activity/data";
import { parseActivityQuery } from "@/lib/activity/query-params";
import { isIsoDate } from "@/lib/activity/utils";
import { requireActivitiesSession } from "@/lib/auth/session";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireActivitiesSession();
  if (!auth.ok)
    return NextResponse.json(
      {
        message:
          auth.status === 401
            ? "Authentication required."
            : auth.status === 403
              ? "Activities is not enabled for your account."
              : "Connect a LiveMopay account first."
      },
      { status: auth.status }
    );
  const limit = await enforceRateLimit(getRateLimitIdentifier(auth.session.userId, "activity-report"));
  const headers = rateLimitHeaders(limit);
  if (!limit.allowed)
    return NextResponse.json({ message: "Rate limit exceeded. Please try again later." }, { status: 429, headers });
  try {
    const filters = parseActivityQuery(new URL(request.url).searchParams);
    if (
      !filters.from ||
      !filters.to ||
      !isIsoDate(filters.from) ||
      !isIsoDate(filters.to) ||
      filters.from > filters.to
    ) {
      return NextResponse.json({ message: "Choose a valid activity report date range." }, { status: 400, headers });
    }
    const report = await loadActivityReport(auth.session.accessToken, {
      from: filters.from,
      to: filters.to,
      tags: filters.tags,
      utility: filters.utility
    });
    return NextResponse.json(report, { headers });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to load the activity report." },
      { status: 500, headers }
    );
  }
}
