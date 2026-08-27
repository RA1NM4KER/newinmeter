import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { disableFreshDataAlertRules } from "@/lib/newinmeter/alerts";
import { DemoAccountProtectedError, setAutoSyncEnabled } from "@/lib/newinmeter/connection";
import { limitUserRequest } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ enabled: z.boolean() });

// Ownership is always resolved from the authenticated session's userId, not
// from any connection id the browser might send -- there's nowhere in this
// request for the client to even supply one.
export async function POST(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }
  const rate = await limitUserRequest(session.userId, "auto-sync", "external");
  if (rate.response) return rate.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  try {
    const connection = await setAutoSyncEnabled(session.userId, parsed.data.enabled);

    // Turning automatic updates off means every fresh-data alert
    // (FRESH_DATA_ALERT_TYPES -- everything except data_delayed) can no
    // longer mean anything -- disable them together rather than leave a
    // "configured but dead" alert silently not firing. The client is expected to have already
    // warned the user which alerts this affects before calling here (using
    // the alert rules it already has loaded), so this is enforcement, not
    // the only warning.
    const disabledAlertTypes = parsed.data.enabled ? [] : await disableFreshDataAlertRules(connection.id);

    return NextResponse.json(
      {
        autoSyncEnabled: connection.autoSyncEnabled,
        nextSyncAt: connection.nextSyncAt,
        disabledAlertTypes
      },
      { headers: rate.headers }
    );
  } catch (error) {
    if (error instanceof DemoAccountProtectedError) {
      return NextResponse.json(
        { message: "This is a shared demo account and does not sync automatically.", demoAccount: true },
        { status: 403 }
      );
    }
    if (error instanceof Error && error.message === "No LiveMopay connection for this user.") {
      return NextResponse.json({ message: "Connect a LiveMopay account first." }, { status: 409 });
    }
    throw error;
  }
}
