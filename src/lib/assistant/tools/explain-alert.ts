import { loadActivityReport } from "@/lib/activity/data";
import { getAlertEventDetail } from "@/lib/newinmeter/alerts";
import type { AssistantTool } from "../types";
import { ExplainAlertSchema } from "./schemas";

function contextNumber(context: Record<string, unknown> | null, key: string): number | null {
  const value = context?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function contextString(context: Record<string, unknown> | null, key: string): string | null {
  const value = context?.[key];
  return typeof value === "string" && value ? value : null;
}

export const explainAlertTool: AssistantTool = {
  definition: {
    type: "function",
    name: "explain_alert",
    description:
      "Explain one specific alert event in full detail: what triggered it, the threshold, surrounding context (e.g. hourly usage and any overlapping Activity for a usage spike, or balance/spend trend for a balance or budget alert), and whether it's already resolved/explained. Ownership of alertEventId is verified server-side. Use this whenever the user asks about a specific alert, e.g. from 'Ask AI' on a notification.",
    parameters: ExplainAlertSchema,
    strict: true
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const alertEventId = typeof args.alertEventId === "string" ? args.alertEventId.trim() : "";

    if (!alertEventId) {
      return { error: "missing_alert_event_id" };
    }

    const detail = await getAlertEventDetail(context.userId, alertEventId);
    if (!detail) {
      // Deliberately identical whether the id is malformed, doesn't exist,
      // or belongs to another user's connection -- never confirms/denies
      // existence of another user's data.
      return { error: "not_found", alertEventId };
    }

    const base = {
      alertEventId: detail.id,
      type: detail.type,
      title: detail.title,
      body: detail.body,
      navigateUrl: detail.navigateUrl,
      triggeredAt: detail.triggeredAt,
      triggerValue: detail.triggerValue,
      thresholdValue: detail.thresholdValue,
      isRead: detail.isRead,
      dateForNavigation: detail.triggeredAt.slice(0, 10)
    };

    if (detail.type !== "usage_anomaly") {
      // Every other type's event_context already carries exactly the
      // numbers the evaluator itself computed -- see notifyCopyFor's own
      // per-type context reads in alerts.ts. Passed through as-is rather
      // than re-derived here, so this can never drift from what actually
      // triggered the alert.
      return { ...base, resolved: detail.resolvedAt !== null, context: detail.context };
    }

    const startAt = contextString(detail.context, "startAt");
    const endAt = contextString(detail.context, "endAt");
    const usageKwh = contextNumber(detail.context, "usageKwh");
    const baselineKwh = contextNumber(detail.context, "baselineKwh");
    const date = startAt?.slice(0, 10) ?? base.dateForNavigation;
    const startHour = startAt ? Number(startAt.slice(11, 13)) : null;
    const endHour = endAt ? Number(endAt.slice(11, 13)) : null;

    const hourlyContext =
      startHour !== null && endHour !== null
        ? context.hourlyRows
            .filter(
              (row) =>
                row.periodDate === date &&
                row.hour >= Math.max(0, startHour - 2) &&
                row.hour <= Math.min(23, endHour + 1)
            )
            .sort((left, right) => left.hour - right.hour)
            .map((row) => ({ hour: row.hour, kwh: row.kwh, spend: row.spend }))
        : [];

    // Related Activities are only pulled when Activities is actually
    // enabled for this account -- explain_alert itself isn't gated on the
    // Activities feature (it's an alert tool), but its output must never
    // surface Activity data past that gate.
    let relatedActivities: Array<{ startsAt: string; endsAt: string; tags: string[] }> = [];

    if (context.permissions.activitiesEnabled && startAt && endAt) {
      try {
        const { rows } = await loadActivityReport(context.accessToken, { from: date, to: date, utility: "all" });
        relatedActivities = rows
          .filter((row) => row.startsAt < endAt && row.endsAt > startAt)
          .map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt, tags: row.tags }));
      } catch {
        // Best-effort context only -- never fail the whole explanation over
        // a secondary Activity lookup.
      }
    }

    return {
      ...base,
      resolved: detail.resolvedAt !== null,
      // resolvedAt is set precisely when a matching Activity already
      // suppressed this event (see resolveOverlappingUsageAnomalyEvents) --
      // "already explained" and "resolved" are the same fact for this type.
      alreadyExplained: detail.resolvedAt !== null,
      window: { startAt, endAt, usageKwh, baselineKwh },
      hourlyContext,
      relatedActivities,
      activitiesAvailable: context.permissions.activitiesEnabled
    };
  }
};
