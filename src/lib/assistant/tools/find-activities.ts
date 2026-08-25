import { loadActivities } from "@/lib/activity/data";
import {
  activityOverlapsRange,
  addDaysToIsoDate,
  buildActivityRange,
  isHalfHourTime,
  isIsoDate,
  normalizeActivityTags
} from "@/lib/activity/utils";
import type { AssistantTool } from "../types";
import { FindActivitiesSchema } from "./schemas";

// The only tool that ever returns an activity id to the model -- needed so
// update_activity/delete_activity can target a real, owned row without the
// model inventing one (get_activity_report deliberately omits ids; see its
// own module comment). Bounded and read-only: it just locates candidates,
// it never mutates anything itself.
const MAX_RESULTS = 20;
const MAX_RANGE_DAYS = 366;
const dayMs = 86_400_000;

function inclusiveDayCount(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / dayMs) + 1;
}

function resolveDateField(explicitValue: unknown, scopeFallback: string): { value: string; invalid: boolean } {
  if (typeof explicitValue === "string" && explicitValue) {
    return { value: explicitValue, invalid: !isIsoDate(explicitValue) };
  }
  return { value: scopeFallback, invalid: false };
}

export const findActivitiesTool: AssistantTool = {
  contextMode: "base",
  definition: {
    type: "function",
    name: "find_activities",
    description:
      "Locate specific logged activities (with exact id, startsAt, endsAt, and tags) by date range, tag, and/or overlapping time window. Overnight end times are next-day. Use before update/delete and for post-action verification. If several rows overlap but one exactly matches the user's requested start/end, select that exact row; do not treat contained overlaps as the same Activity. Never invent an activityId.",
    parameters: FindActivitiesSchema,
    strict: true
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const fromField = resolveDateField(args.from, context.scope.from);
    const toField = resolveDateField(args.to, context.scope.to);

    if (fromField.invalid || toField.invalid) {
      return { error: "invalid_date_range", message: "from and to must be valid ISO dates in YYYY-MM-DD format." };
    }

    const from = fromField.value;
    const to = toField.value;
    if (!from || !to) {
      return { scope: { from, to }, available: false, reason: "missing_scope", activities: [] };
    }
    if (from > to) {
      return { error: "invalid_date_range", message: "from must not be after to." };
    }
    if (inclusiveDayCount(from, to) > MAX_RANGE_DAYS) {
      return {
        error: "activity_range_too_large",
        message: `find_activities supports a maximum range of ${MAX_RANGE_DAYS} days.`,
        maximumDays: MAX_RANGE_DAYS
      };
    }

    const tag = typeof args.tag === "string" && args.tag ? normalizeActivityTags([args.tag])[0] : undefined;
    const startTime = typeof args.startTime === "string" && isHalfHourTime(args.startTime) ? args.startTime : undefined;
    const endTime =
      typeof args.endTime === "string" && (isHalfHourTime(args.endTime) || args.endTime === "00:00")
        ? args.endTime
        : undefined;

    const rows = await loadActivities(context.accessToken, {
      from,
      to,
      tags: tag ? [tag] : []
    });

    // Build real half-open date-time ranges for every queried local date.
    // buildActivityRange already owns overnight semantics: end <= start
    // means the following day. This also lets an Activity that began on the
    // previous date match an after-midnight query on the current date.
    const requestedWindows: Array<{ startsAt: string; endsAt: string }> = [];
    if (startTime && endTime) {
      for (let date = from; date <= to; date = addDaysToIsoDate(date, 1)) {
        requestedWindows.push(buildActivityRange({ date, allDay: false, startTime, endTime }));
      }
    }
    const filtered =
      startTime && endTime
        ? rows.filter((row) =>
            requestedWindows.some((window) =>
              activityOverlapsRange(row.startsAt, row.endsAt, window.startsAt, window.endsAt)
            )
          )
        : rows;

    return {
      scope: { from, to },
      activities: filtered.slice(0, MAX_RESULTS).map((row) => ({
        id: row.id,
        date: row.startsAt.slice(0, 10),
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        allDay: row.allDay,
        tags: row.tags,
        note: row.note ?? null
      })),
      metadata: {
        matchedCount: filtered.length,
        returnedCount: Math.min(filtered.length, MAX_RESULTS),
        truncated: filtered.length > MAX_RESULTS
      }
    };
  }
};
