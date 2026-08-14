import { NextResponse } from "next/server";
import { activityValidationErrors, deleteActivity, updateActivity } from "@/lib/activity-data";
import type { ActivityInput } from "@/lib/activity-utils";
import { requireActivitiesSession } from "@/lib/auth/session";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

async function authorize(scope: string) {
  const auth = await requireActivitiesSession();
  if (!auth.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          message:
            auth.status === 401
              ? "Authentication required."
              : auth.status === 403
                ? "Activities is not enabled for your account."
                : "Connect a LiveMopay account first."
        },
        { status: auth.status }
      )
    };
  }
  const limit = await enforceRateLimit(getRateLimitIdentifier(auth.session.userId, scope));
  const headers = rateLimitHeaders(limit);
  if (!limit.allowed)
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Rate limit exceeded. Please try again later." }, { status: 429, headers })
    };
  return { ok: true as const, session: auth.session, headers };
}

function parseUpdates(body: Record<string, unknown>): Partial<ActivityInput> {
  const updates: Partial<ActivityInput> = {};
  if (typeof body.date === "string") updates.date = body.date;
  if (typeof body.allDay === "boolean") updates.allDay = body.allDay;
  if (typeof body.startTime === "string") updates.startTime = body.startTime;
  if (typeof body.endTime === "string") updates.endTime = body.endTime;
  if (Array.isArray(body.tags)) updates.tags = body.tags.filter((tag): tag is string => typeof tag === "string");
  if (typeof body.color === "string") updates.color = body.color;
  if (typeof body.note === "string" || body.note === null) updates.note = body.note;
  return updates;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const access = await authorize("activities-write");
  if (!access.ok) return access.response;
  try {
    const activity = await updateActivity(
      access.session.accessToken,
      access.session.connection.id,
      params.id,
      parseUpdates((await request.json()) as Record<string, unknown>)
    );
    if (!activity)
      return NextResponse.json({ message: "Activity not found." }, { status: 404, headers: access.headers });
    return NextResponse.json({ activity }, { headers: access.headers });
  } catch (error) {
    const errors = activityValidationErrors(error);
    return NextResponse.json(
      {
        message: errors
          ? "Check the activity details."
          : error instanceof Error
            ? error.message
            : "Failed to update activity.",
        errors
      },
      { status: errors ? 400 : 500, headers: access.headers }
    );
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const access = await authorize("activities-write");
  if (!access.ok) return access.response;
  try {
    const activity = await deleteActivity(access.session.accessToken, params.id);
    if (!activity)
      return NextResponse.json({ message: "Activity not found." }, { status: 404, headers: access.headers });
    return NextResponse.json({ activity }, { headers: access.headers });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Failed to delete activity." },
      { status: 500, headers: access.headers }
    );
  }
}
