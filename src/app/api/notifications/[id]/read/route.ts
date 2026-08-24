import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/newinmeter/alerts";

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

  await markNotificationRead(session.userId, params.id);
  return NextResponse.json({ ok: true });
}
