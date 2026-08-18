import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { discoverLiveMopayAccounts, loginWithLiveMopayCredentials } from "@/lib/newinmeter-web";
import { beginLivemopayConnection, DemoAccountProtectedError, getConnectionForUser } from "@/lib/newinmeter-connection";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const connectRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(256)
});

export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  const identifier = getRateLimitIdentifier(session.userId, "livemopay-connect");
  const rateLimit = await enforceRateLimit(identifier, "assistant");
  const rateHeaders = rateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    return NextResponse.json({ message: "Too many attempts. Try again later." }, { status: 429, headers: rateHeaders });
  }

  try {
    const existing = await getConnectionForUser(session.userId);
    if (existing?.isDemo) {
      return NextResponse.json(
        {
          message: "This is a shared demo account and cannot be connected to real LiveMopay credentials.",
          demoAccount: true
        },
        { status: 403, headers: rateHeaders }
      );
    }
    if (existing?.status === "connected") {
      return NextResponse.json(
        { message: "A LiveMopay account is already connected." },
        { status: 409, headers: rateHeaders }
      );
    }

    const body = connectRequestSchema.parse(await request.json());

    // The password is used exactly once, right here, to obtain a Firebase ID
    // token and refresh token. It is never written to a variable that
    // outlives this request, never logged, and never stored.
    const liveMopaySession = await loginWithLiveMopayCredentials(body.email, body.password);
    const candidates = await discoverLiveMopayAccounts(liveMopaySession.idToken);

    if (candidates.length === 0) {
      return NextResponse.json(
        { message: "Could not find a LiveMopay account for these credentials." },
        { status: 422, headers: rateHeaders }
      );
    }

    const connection = await beginLivemopayConnection({
      userId: session.userId,
      livemopayEmail: body.email,
      firebaseLocalId: liveMopaySession.localId,
      refreshToken: liveMopaySession.refreshToken,
      candidates
    });

    if (connection.status === "pending_selection") {
      return NextResponse.json(
        {
          status: "pending_selection",
          accounts: (connection.pendingAccounts ?? []).map((account, index) => ({ index, label: account.label }))
        },
        { headers: rateHeaders }
      );
    }

    return NextResponse.json({ status: "connected", accountLabel: connection.accountLabel }, { headers: rateHeaders });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Enter a valid LiveMopay email and password." },
        { status: 400, headers: rateHeaders }
      );
    }

    if (error instanceof DemoAccountProtectedError) {
      return NextResponse.json(
        {
          message: "This is a shared demo account and cannot be connected to real LiveMopay credentials.",
          demoAccount: true
        },
        { status: 403, headers: rateHeaders }
      );
    }

    console.error("livemopay_connect_failed", error instanceof Error ? error.message : "unknown_error");
    return NextResponse.json(
      { message: "Could not connect your LiveMopay account." },
      { status: 500, headers: rateHeaders }
    );
  }
}
