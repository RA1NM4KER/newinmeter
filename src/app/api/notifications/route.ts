import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getRecentNotifications } from "@/lib/newinmeter/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Recent notifications for the header bell -- ownership resolved from the
// session, capped/newest-first, includes resolved historical events.
export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const notifications = await getRecentNotifications(session.userId);
  return NextResponse.json({ notifications });
}
