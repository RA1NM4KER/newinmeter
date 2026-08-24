import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/lib/newinmeter/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const markedCount = await markAllNotificationsRead(session.userId);
  return NextResponse.json({ ok: true, markedCount });
}
