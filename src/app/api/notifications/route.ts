import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getRecentNotifications, hasAnyEnabledAlertRule } from "@/lib/newinmeter/alerts";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Recent notifications for the header bell -- ownership resolved from the
// session, capped/newest-first, includes resolved historical events.
// hasEnabledAlerts lets an empty list distinguish "nothing configured yet"
// (point the user at Settings) from "configured, just hasn't fired" (plain
// "all caught up").
export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }
  const rate = await limitUserRequest(session.userId, "notifications-read");
  if (rate.response) return rate.response;

  const [notifications, hasEnabledAlerts] = await Promise.all([
    getRecentNotifications(session.userId),
    hasAnyEnabledAlertRule(session.userId)
  ]);
  return NextResponse.json({ notifications, hasEnabledAlerts }, { headers: rate.headers });
}
