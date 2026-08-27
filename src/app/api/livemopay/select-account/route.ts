import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { DemoAccountProtectedError, finalizeLivemopayAccountSelection } from "@/lib/newinmeter/connection";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const selectAccountRequestSchema = z.object({
  index: z.number().int().min(0).max(50)
});

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }
  const rate = await limitUserRequest(session.userId, "select-account", "external");
  if (rate.response) return rate.response;

  try {
    const body = selectAccountRequestSchema.parse(await request.json());
    const connection = await finalizeLivemopayAccountSelection(session.userId, body.index);

    return NextResponse.json(
      { status: "connected", accountLabel: connection.accountLabel },
      { headers: rate.headers }
    );
  } catch (error) {
    if (error instanceof DemoAccountProtectedError) {
      return NextResponse.json({ message: error.message, demoAccount: true }, { status: 403, headers: rate.headers });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: "Select one of the listed accounts." }, { status: 400 });
    }

    console.error("livemopay_select_account_failed", error instanceof Error ? error.message : "unknown_error");
    return NextResponse.json({ message: "Could not finish connecting your account." }, { status: 500 });
  }
}
