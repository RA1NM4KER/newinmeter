import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSession } from "@/lib/auth/session";
import { hasFeatureAccess } from "@/lib/features";
import { DemoAccountProtectedError } from "@/lib/newinmeter/connection";
import {
  ALERT_TYPES,
  AlertRuleValidationError,
  AutoSyncRequiredError,
  upsertAlertRule,
  type AlertType
} from "@/lib/newinmeter/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().nullable(),
  alsoEnableAutoSync: z.boolean().optional()
});

function isAlertType(value: string): value is AlertType {
  return (ALERT_TYPES as string[]).includes(value);
}

// Ownership is always resolved from the authenticated session's userId --
// the [type] segment only ever selects which alert row to touch, never
// which connection. There is nowhere in this request for the client to
// supply a connection id.
export async function POST(request: Request, { params }: { params: { type: string } }) {
  const session = await getAuthenticatedSession();
  if (!session) {
    return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  }

  if (!isAlertType(params.type)) {
    return NextResponse.json({ message: "Unknown alert type." }, { status: 404 });
  }

  if (!(await hasFeatureAccess(session.userId, "alerts"))) {
    return NextResponse.json({ message: "Alerts are disabled for your account." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  try {
    const result = await upsertAlertRule({
      userId: session.userId,
      type: params.type,
      enabled: parsed.data.enabled,
      threshold: parsed.data.threshold,
      alsoEnableAutoSync: parsed.data.alsoEnableAutoSync
    });

    return NextResponse.json({
      rule: result.rule,
      autoSyncEnabled: result.autoSyncEnabled,
      nextSyncAt: result.nextSyncAt
    });
  } catch (error) {
    if (error instanceof DemoAccountProtectedError) {
      return NextResponse.json(
        { message: "This is a shared demo account.", demoAccount: true },
        { status: 403 }
      );
    }
    if (error instanceof AutoSyncRequiredError) {
      return NextResponse.json(
        { message: error.message, autoSyncRequired: true },
        { status: 409 }
      );
    }
    if (error instanceof AlertRuleValidationError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message === "No LiveMopay connection for this user.") {
      return NextResponse.json({ message: "Connect a LiveMopay account first." }, { status: 409 });
    }
    throw error;
  }
}
