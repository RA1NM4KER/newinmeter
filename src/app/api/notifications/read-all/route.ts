import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/lib/newinmeter/alerts";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }
  const rate = await limitUserRequest(session.userId, "notifications-write");
  if (rate.response) return rate.response;

  const markedCount = await markAllNotificationsRead(session.userId);
  return NextResponse.json({ ok: true, markedCount }, { headers: rate.headers });
}
