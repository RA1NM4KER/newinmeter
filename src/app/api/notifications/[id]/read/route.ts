import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/newinmeter/alerts";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Ownership is always resolved from the authenticated session's userId --
// the [id] segment only ever selects which of THAT user's own events to
// mark read (markNotificationRead additionally filters by the resolved
// connection_id), never a connection the caller doesn't own.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }
  const rate = await limitUserRequest(session.userId, "notifications-write");
  if (rate.response) return rate.response;

  await markNotificationRead(session.userId, params.id);
  return NextResponse.json({ ok: true }, { headers: rate.headers });
}
