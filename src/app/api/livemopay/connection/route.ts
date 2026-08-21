import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { getConnectionForUser } from "@/lib/newinmeter/connection";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const connection = await getConnectionForUser(session.userId);
  if (!connection) {
    return NextResponse.json({ status: "not_connected" });
  }

  return NextResponse.json({
    status: connection.status,
    livemopayEmail: connection.livemopayEmail,
    accountLabel: connection.accountLabel,
    connectedAt: connection.connectedAt,
    lastSyncedAt: connection.lastSyncedAt,
    lastError: connection.lastError
  });
}
