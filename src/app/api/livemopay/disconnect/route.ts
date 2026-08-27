import { NextResponse } from "next/server";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { DemoAccountProtectedError, disconnectLivemopayConnection } from "@/lib/newinmeter/connection";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }
  const rate = await limitUserRequest(session.userId, "disconnect", "external");
  if (rate.response) return rate.response;

  try {
    await disconnectLivemopayConnection(session.userId);
    return NextResponse.json({ status: "disconnected" }, { headers: rate.headers });
  } catch (error) {
    if (error instanceof DemoAccountProtectedError) {
      return NextResponse.json(
        { message: "This is a shared demo account and cannot be disconnected.", demoAccount: true },
        { status: 403 }
      );
    }
    throw error;
  }
}
