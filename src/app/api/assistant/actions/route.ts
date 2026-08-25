import { NextResponse } from "next/server";
import { z } from "zod";
import { activityValidationErrors, createActivity, deleteActivity, updateActivity } from "@/lib/activity/data";
import {
  isHalfHourTime,
  isIsoDate,
  ACTIVITY_MAX_TAGS,
  ACTIVITY_MAX_TAG_LENGTH,
  type ActivityInput
} from "@/lib/activity/utils";
import { requireConnectedSession, type AuthenticatedConnectionSession } from "@/lib/auth/session";
import { hasFeatureAccess } from "@/lib/features";
import { loadDashboardSummary } from "@/lib/dashboard-data";
import { ALERT_TYPES, type AlertType } from "@/lib/newinmeter/alert-types";
import {
  AlertRuleValidationError,
  AutoSyncRequiredError,
  DEFAULT_THRESHOLDS,
  evaluateAlertsAfterSync,
  getAlertRulesForUser,
  resolveOverlappingUsageAnomalyEvents,
  upsertAlertRule
} from "@/lib/newinmeter/alerts";
import {
  DemoAccountProtectedError,
  getConnectionRowForUser,
  getDecryptedRefreshToken,
  markConnectionAuthError,
  markConnectionSyncOutcome,
  replaceConnectionRefreshToken
} from "@/lib/newinmeter/connection";
import { runLivemopaySync, SyncAlreadyRunningError } from "@/lib/newinmeter/sync";
import { TokenDecryptionError } from "@/lib/token-encryption";
import { enforceRateLimit, getRateLimitIdentifier, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-side execution for assistant-proposed mutations. The model never
// calls this directly and never has credentials to -- it only ever emits an
// AssistantAction object in its structured response (see response-schema.ts
// and system-prompt.ts). This route is reached only after the user clicks
// Confirm on that proposal in the UI, and every argument here is
// independently re-validated -- the LLM's own structured-output validation
// on the way out is not trusted as the only check on the way back in.
const alertTypeEnum = z.enum(ALERT_TYPES as [AlertType, ...AlertType[]]);

const addActivitySchema = z.object({
  type: z.literal("add_activity"),
  date: z.string().refine(isIsoDate, "Invalid date."),
  start: z.string().refine(isHalfHourTime, "Invalid start time."),
  end: z.string().refine((value) => isHalfHourTime(value) || value === "00:00", "Invalid end time."),
  tags: z.array(z.string().trim().min(1).max(ACTIVITY_MAX_TAG_LENGTH)).min(1).max(ACTIVITY_MAX_TAGS)
});

// activityId is trusted only as an opaque lookup key -- ownership is
// re-verified server-side by RLS inside updateActivity/deleteActivity
// itself (see /api/activities/[id]/route.ts's identical pattern), not by
// anything the model claimed. It must still be a well-formed UUID: the
// usage_activities.id column IS one, and PostgREST returns a raw 400 ("invalid
// input syntax for type uuid") for anything else -- rejecting a malformed id
// here with a clean 400 keeps that Postgres error text from ever reaching
// the client (also enforced earlier, at response-schema.ts, so a fabricated
// id normally never even reaches a rendered confirm button -- this is the
// second, independent check for a stale/tampered client request).
const updateActivitySchema = z.object({
  type: z.literal("update_activity"),
  activityId: z.string().uuid(),
  date: z.string().refine(isIsoDate, "Invalid date."),
  start: z.string().refine(isHalfHourTime, "Invalid start time."),
  end: z.string().refine((value) => isHalfHourTime(value) || value === "00:00", "Invalid end time."),
  tags: z.array(z.string().trim().min(1).max(ACTIVITY_MAX_TAG_LENGTH)).min(1).max(ACTIVITY_MAX_TAGS),
  note: z.string().max(280).nullable()
});

const deleteActivitySchema = z.object({
  type: z.literal("delete_activity"),
  activityId: z.string().uuid()
});

const setAlertSchema = z.object({
  type: z.literal("set_alert"),
  alertType: alertTypeEnum,
  threshold: z.number().nullable(),
  alsoEnableAutoSync: z.boolean().optional()
});

const updateAlertSchema = z.object({
  type: z.literal("update_alert"),
  alertType: alertTypeEnum,
  threshold: z.number().nullable(),
  alsoEnableAutoSync: z.boolean().optional()
});

const disableAlertSchema = z.object({
  type: z.literal("disable_alert"),
  alertType: alertTypeEnum
});

const syncSchema = z.object({ type: z.literal("sync") });

const actionRequestSchema = z.discriminatedUnion("type", [
  addActivitySchema,
  updateActivitySchema,
  deleteActivitySchema,
  setAlertSchema,
  updateAlertSchema,
  disableAlertSchema,
  syncSchema
]);

function demoReadOnlyError() {
  return NextResponse.json({ message: "Demo data is read-only.", demoAccount: true }, { status: 403 });
}

async function handleAddActivity(session: AuthenticatedConnectionSession, body: z.infer<typeof addActivitySchema>) {
  if (!(await hasFeatureAccess(session.userId, "activities"))) {
    return NextResponse.json({ message: "Activities is not enabled for your account." }, { status: 403 });
  }
  if (session.connection.isDemo) {
    return demoReadOnlyError();
  }

  const input: ActivityInput = {
    date: body.date,
    allDay: false,
    startTime: body.start,
    endTime: body.end,
    tags: body.tags,
    color: undefined,
    note: undefined
  };

  try {
    const activity = await createActivity(session.accessToken, session.connection.id, input);

    try {
      await resolveOverlappingUsageAnomalyEvents(session.connection.id, activity.startsAt, activity.endsAt);
    } catch (error) {
      console.error(
        "newinmeter_resolve_usage_anomaly_on_assistant_activity_failed",
        error instanceof Error ? error.message : String(error)
      );
    }

    return NextResponse.json({ activity }, { status: 201 });
  } catch (error) {
    const errors = activityValidationErrors(error);
    return NextResponse.json(
      { message: errors ? "Check the activity details." : "Failed to add activity.", errors },
      { status: errors ? 400 : 500 }
    );
  }
}

async function handleUpdateActivity(
  session: AuthenticatedConnectionSession,
  body: z.infer<typeof updateActivitySchema>
) {
  if (!(await hasFeatureAccess(session.userId, "activities"))) {
    return NextResponse.json({ message: "Activities is not enabled for your account." }, { status: 403 });
  }
  if (session.connection.isDemo) {
    return demoReadOnlyError();
  }

  const updates: ActivityInput = {
    date: body.date,
    allDay: false,
    startTime: body.start,
    endTime: body.end,
    tags: body.tags,
    note: body.note
  };

  try {
    // Returns null for a not-found OR not-owned id -- RLS (via
    // session.accessToken) is the sole ownership boundary, same as
    // /api/activities/[id]/route.ts's PATCH.
    const activity = await updateActivity(session.accessToken, session.connection.id, body.activityId, updates);
    if (!activity) {
      return NextResponse.json({ message: "Activity not found." }, { status: 404 });
    }
    return NextResponse.json({ activity });
  } catch (error) {
    const errors = activityValidationErrors(error);
    return NextResponse.json(
      { message: errors ? "Check the activity details." : "Failed to update activity.", errors },
      { status: errors ? 400 : 500 }
    );
  }
}

async function handleDeleteActivity(
  session: AuthenticatedConnectionSession,
  body: z.infer<typeof deleteActivitySchema>
) {
  if (!(await hasFeatureAccess(session.userId, "activities"))) {
    return NextResponse.json({ message: "Activities is not enabled for your account." }, { status: 403 });
  }
  if (session.connection.isDemo) {
    return demoReadOnlyError();
  }

  try {
    // Same RLS ownership boundary as update -- null means not found OR not
    // owned, and both return an identical 404 so ownership can't be probed.
    const activity = await deleteActivity(session.accessToken, body.activityId);
    if (!activity) {
      return NextResponse.json({ message: "Activity not found." }, { status: 404 });
    }
    return NextResponse.json({ activity });
  } catch (error) {
    // Never forward the raw underlying error text (e.g. a Postgres/
    // PostgREST message) to the client -- log it server-side instead, same
    // posture as handleSync's own catch block below.
    console.error("newinmeter_assistant_delete_activity_failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ message: "Failed to delete activity." }, { status: 500 });
  }
}

async function handleAlertMutation(
  session: AuthenticatedConnectionSession,
  body:
    | z.infer<typeof setAlertSchema>
    | z.infer<typeof updateAlertSchema>
    | (z.infer<typeof disableAlertSchema> & { threshold?: null; alsoEnableAutoSync?: undefined })
) {
  if (!(await hasFeatureAccess(session.userId, "alerts"))) {
    return NextResponse.json({ message: "Alerts are disabled for your account." }, { status: 403 });
  }

  const enabled = body.type !== "disable_alert";

  try {
    // Disabling a threshold-bearing alert still needs a valid (non-null)
    // threshold in the write itself (validateThreshold rejects null
    // regardless of `enabled` for THRESHOLD_ALERT_TYPES) -- mirrors
    // alert-rule-row.tsx's own disable flow, which resends the current
    // threshold rather than clearing it. Falls back to the existing rule's
    // threshold, then the product default, for a type that was never
    // configured at all.
    let threshold = enabled ? (body.threshold ?? null) : null;
    if (!enabled && threshold === null) {
      const existingRules = await getAlertRulesForUser(session.userId);
      threshold =
        existingRules.find((rule) => rule.type === body.alertType)?.threshold ??
        DEFAULT_THRESHOLDS[body.alertType] ??
        null;
    }

    const result = await upsertAlertRule({
      userId: session.userId,
      type: body.alertType,
      enabled,
      threshold,
      alsoEnableAutoSync: "alsoEnableAutoSync" in body ? body.alsoEnableAutoSync : undefined
    });

    return NextResponse.json({
      rule: result.rule,
      autoSyncEnabled: result.autoSyncEnabled,
      nextSyncAt: result.nextSyncAt
    });
  } catch (error) {
    if (error instanceof DemoAccountProtectedError) {
      return demoReadOnlyError();
    }
    if (error instanceof AutoSyncRequiredError) {
      return NextResponse.json({ message: error.message, autoSyncRequired: true }, { status: 409 });
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

async function handleSync(session: AuthenticatedConnectionSession) {
  // Mirrors /api/sync's own POST handler -- kept as a second, thin route-
  // glue implementation (same pattern as every other pair of near-identical
  // route handlers in this codebase, e.g. daily-rollups vs day-intervals)
  // rather than an internal HTTP call, so this stays a plain authenticated
  // server function call with no cookie-forwarding fragility. All of the
  // actual sync logic is the same shared runLivemopaySync/evaluateAlertsAfterSync
  // domain functions the real route calls -- nothing here reimplements sync.
  const connectionRow = await getConnectionRowForUser(session.userId);

  if (
    !connectionRow ||
    connectionRow.status !== "connected" ||
    !connectionRow.account_id ||
    !connectionRow.company_id ||
    !connectionRow.property_id
  ) {
    return NextResponse.json({ message: "Connect a LiveMopay account first." }, { status: 409 });
  }

  if (connectionRow.is_demo) {
    return NextResponse.json(
      { message: "This account uses fixed demo data and cannot sync with LiveMopay.", demoAccount: true },
      { status: 403 }
    );
  }

  try {
    const refreshToken = getDecryptedRefreshToken(connectionRow);
    const result = await runLivemopaySync({
      connectionId: connectionRow.id,
      accountId: connectionRow.account_id,
      companyId: connectionRow.company_id,
      propertyId: connectionRow.property_id,
      refreshToken,
      mode: "incremental",
      onRefreshTokenRotated: (newRefreshToken) => replaceConnectionRefreshToken(connectionRow.id, newRefreshToken)
    });

    await markConnectionSyncOutcome(connectionRow.id, null);
    await evaluateAlertsAfterSync(connectionRow.id, session.userId);
    const summary = await loadDashboardSummary(session.accessToken);

    return NextResponse.json({ mode: "incremental", summary, output: result.output });
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    if (error instanceof TokenDecryptionError) {
      console.error("newinmeter_assistant_sync_failed", error.message);
      await markConnectionAuthError(connectionRow.id).catch(() => {});
      return NextResponse.json(
        { message: "Your LiveMopay connection needs to be reconnected.", reauthRequired: true },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Sync failed.";
    console.error("newinmeter_assistant_sync_failed", message);
    await markConnectionSyncOutcome(connectionRow.id, message).catch(() => {});
    return NextResponse.json({ message: "Sync failed." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireConnectedSession();
  if (!auth.ok) {
    return NextResponse.json(
      { message: auth.status === 401 ? "Authentication required." : "Connect a LiveMopay account first." },
      { status: auth.status }
    );
  }

  if (!(await hasFeatureAccess(auth.session.userId, "ai"))) {
    return NextResponse.json({ message: "The energy assistant is disabled for your account." }, { status: 403 });
  }

  const identifier = getRateLimitIdentifier(auth.session.userId, "assistantAction");
  const rateLimit = await enforceRateLimit(identifier, "assistantAction");
  const rateHeaders = rateLimitHeaders(rateLimit);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: "Rate limit exceeded. Please try again later." },
      { status: 429, headers: rateHeaders }
    );
  }

  const parsed = actionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid action request." }, { status: 400, headers: rateHeaders });
  }

  try {
    let response: NextResponse;
    switch (parsed.data.type) {
      case "add_activity":
        response = await handleAddActivity(auth.session, parsed.data);
        break;
      case "update_activity":
        response = await handleUpdateActivity(auth.session, parsed.data);
        break;
      case "delete_activity":
        response = await handleDeleteActivity(auth.session, parsed.data);
        break;
      case "set_alert":
      case "update_alert":
        response = await handleAlertMutation(auth.session, parsed.data);
        break;
      case "disable_alert":
        response = await handleAlertMutation(auth.session, parsed.data);
        break;
      case "sync":
        response = await handleSync(auth.session);
        break;
    }

    for (const [key, value] of Object.entries(rateHeaders)) {
      response.headers.set(key, value);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to perform action.";
    console.error("newinmeter_assistant_action_failed", message);
    return NextResponse.json({ message: "Failed to perform action." }, { status: 500, headers: rateHeaders });
  }
}
