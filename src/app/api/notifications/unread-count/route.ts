import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/lib/newinmeter/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const count = await getUnreadNotificationCount(session.userId);
  return NextResponse.json({ count });
}
