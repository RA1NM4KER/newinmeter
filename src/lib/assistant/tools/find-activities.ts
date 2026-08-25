import { loadActivityReport } from "@/lib/activity/data";
import { isHalfHourTime, isIsoDate, normalizeActivityTags } from "@/lib/activity/utils";
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
  definition: {
    type: "function",
    name: "find_activities",
    description:
      "Locate specific logged activities (with their id) by date range, tag, and/or time-of-day window -- use this before proposing update_activity or delete_activity, to resolve which real activity the user means. Never invent an activityId; only use one returned here.",
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

    const { rows } = await loadActivityReport(context.accessToken, {
      from,
      to,
      tags: tag ? [tag] : [],
      utility: "all"
    });

    // Time-of-day overlap filter (both bounds supplied): compares the
    // HH:MM portion of each occurrence's own start/end against the
    // requested window -- plain string comparison is safe since both sides
    // are always zero-padded 24h "HH:MM".
    const filtered =
      startTime && endTime
        ? rows.filter((row) => {
            const rowStart = row.startsAt.slice(11, 16);
            const rowEndRaw = row.endsAt.slice(11, 16);
            const rowEnd = row.allDay || rowEndRaw === "00:00" ? "24:00" : rowEndRaw;
            const windowEnd = endTime === "00:00" ? "24:00" : endTime;
            return rowStart < windowEnd && rowEnd > startTime;
          })
        : rows;

    return {
      scope: { from, to },
      activities: filtered.slice(0, MAX_RESULTS).map((row) => ({
        id: row.id,
        date: row.date,
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
