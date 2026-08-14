import { NextResponse } from "next/server";
import { activityValidationErrors, createActivity, loadActivities, loadActivityTags } from "@/lib/activity-data";
import { parseActivityQuery } from "@/lib/activity-query-params";
import { isIsoDate, type ActivityInput } from "@/lib/activity-utils";
import { requireActivitiesSession } from "@/lib/auth/session";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function authError(status: 401 | 403 | 409) {
  return NextResponse.json(
    {
      message:
        status === 401
          ? "Authentication required."
          : status === 403
            ? "Activities is not enabled for your account."
            : "Connect a LiveMopay account first."
    },
    { status }
  );
}

async function limitedSession(scope: string) {
  const auth = await requireActivitiesSession();
  if (!auth.ok) return { ok: false as const, response: authError(auth.status) };
  const rateLimit = await enforceRateLimit(getRateLimitIdentifier(auth.session.userId, scope));
  const headers = rateLimitHeaders(rateLimit);
  if (!rateLimit.allowed) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Rate limit exceeded. Please try again later." }, { status: 429, headers })
    };
  }
  return { ok: true as const, session: auth.session, headers };
}

export async function GET(request: Request) {
  const access = await limitedSession("activities-read");
  if (!access.ok) return access.response;
  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("mode") === "tags") {
      return NextResponse.json(await loadActivityTags(access.session.accessToken), { headers: access.headers });
    }
    const filters = parseActivityQuery(searchParams);
    if ((filters.from && !isIsoDate(filters.from)) || (filters.to && !isIsoDate(filters.to))) {
      return NextResponse.json({ message: "Invalid activity date filter." }, { status: 400, headers: access.headers });
    }
    const activities = await loadActivities(access.session.accessToken, filters);
    return NextResponse.json({ activities }, { headers: access.headers });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to load activities." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const access = await limitedSession("activities-write");
  if (!access.ok) return access.response;
  try {
    const body = (await request.json()) as Partial<ActivityInput>;
    const input: ActivityInput = {
      date: typeof body.date === "string" ? body.date : "",
      allDay: body.allDay === true,
      startTime: typeof body.startTime === "string" ? body.startTime : undefined,
      endTime: typeof body.endTime === "string" ? body.endTime : undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [],
      color: typeof body.color === "string" ? body.color : undefined,
      note: typeof body.note === "string" || body.note === null ? body.note : undefined
    };
    const activity = await createActivity(access.session.accessToken, access.session.connection.id, input);
    return NextResponse.json({ activity }, { status: 201, headers: access.headers });
  } catch (error) {
    const errors = activityValidationErrors(error);
    return NextResponse.json(
      {
        message: errors
          ? "Check the activity details."
          : error instanceof Error
            ? error.message
            : "Failed to create activity.",
        errors
      },
      { status: errors ? 400 : 500, headers: access.headers }
    );
  }
}
