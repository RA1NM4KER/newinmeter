import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/lib/newinmeter/alerts";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }
  const rate = await limitUserRequest(session.userId, "notifications-count");
  if (rate.response) return rate.response;

  const count = await getUnreadNotificationCount(session.userId);
  return NextResponse.json({ count }, { headers: rate.headers });
}
