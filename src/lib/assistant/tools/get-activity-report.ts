import { loadActivityReport } from "@/lib/activity/data";
import { isIsoDate, normalizeActivityTags } from "@/lib/activity/utils";
import type { ActivityReportRow } from "@/lib/types";
import type { AssistantTool } from "../types";
import { GetActivityReportSchema } from "./schemas";

const MAX_OUTPUT_ACTIVITIES = 50;
const MAX_INPUT_TAGS = 20;
const MAX_RANGE_DAYS = 366;
const dayMs = 86_400_000;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

// Inclusive day count between two YYYY-MM-DD dates, e.g. the same date is a
// 1-day range and a full calendar year is a 365/366-day range.
function inclusiveDayCount(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / dayMs) + 1;
}

// Deliberately omits row.id -- the assistant is read-only and never needs
// the activity UUID to explain usage; the id stays internal to the
// Activities CRUD API and UI, not the assistant tool payload.
function mapOccurrence(row: ActivityReportRow, includeNotes: boolean) {
  return {
    date: row.date,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    durationMinutes: row.durationMinutes,
    tags: row.tags,
    ...(includeNotes && row.note ? { note: row.note } : {}),
    electricityKwh: round2(row.electricityKwh),
    averageKw: round2(row.averageKw),
    electricitySpend: round2(row.electricitySpend),
    waterKl: round2(row.waterKl),
    waterSpend: round2(row.waterSpend)
  };
}

// Grouping happens in memory over the *complete* fetched report (every row
// the report RPC returned, not the MAX_OUTPUT_ACTIVITIES-capped slice) --
// never issue a separate report query per tag. An activity with multiple
// tags (or an activity whose window overlaps another activity's) is counted
// under every tag it carries, so per-tag totals are not mutually exclusive
// and must not be summed together as if they were.
function groupByTag(rows: ActivityReportRow[]) {
  const byTag = new Map<
    string,
    {
      tag: string;
      activityCount: number;
      totalDurationMinutes: number;
      totalElectricityKwh: number;
      totalElectricitySpend: number;
      totalWaterKl: number;
      totalWaterSpend: number;
    }
  >();

  for (const row of rows) {
    for (const tag of row.tags) {
      const bucket = byTag.get(tag) ?? {
        tag,
        activityCount: 0,
        totalDurationMinutes: 0,
        totalElectricityKwh: 0,
        totalElectricitySpend: 0,
        totalWaterKl: 0,
        totalWaterSpend: 0
      };
      bucket.activityCount += 1;
      bucket.totalDurationMinutes += row.durationMinutes;
      bucket.totalElectricityKwh += row.electricityKwh;
      bucket.totalElectricitySpend += row.electricitySpend;
      bucket.totalWaterKl += row.waterKl;
      bucket.totalWaterSpend += row.waterSpend;
      byTag.set(tag, bucket);
    }
  }

  return Array.from(byTag.values())
    .map((bucket) => ({
      tag: bucket.tag,
      activityCount: bucket.activityCount,
      totalDurationMinutes: bucket.totalDurationMinutes,
      totalElectricityKwh: round2(bucket.totalElectricityKwh),
      averageElectricityKwhPerActivity:
        bucket.activityCount > 0 ? round2(bucket.totalElectricityKwh / bucket.activityCount) : 0,
      totalElectricitySpend: round2(bucket.totalElectricitySpend),
      totalWaterKl: round2(bucket.totalWaterKl),
      totalWaterSpend: round2(bucket.totalWaterSpend)
    }))
    .sort((left, right) => right.totalElectricityKwh - left.totalElectricityKwh);
}

type DateFieldResolution = { value: string; invalid: boolean };

// Resolution order: (1) an explicit, valid ISO date argument, else (2) the
// active dashboard scope for that boundary. context.scope already folds in
// step (3) -- the full dashboard summary range -- as its own fallback (see
// tools/index.ts's pickScope), so reading context.scope here already covers
// both step 2 and step 3 without duplicating that fallback logic. A missing
// argument therefore never expands past the dashboard's own resolved scope;
// an explicit but malformed argument is flagged invalid rather than quietly
// discarded in favor of the fallback.
function resolveDateField(explicitValue: unknown, scopeFallback: string): DateFieldResolution {
  if (typeof explicitValue === "string" && explicitValue) {
    return { value: explicitValue, invalid: !isIsoDate(explicitValue) };
  }
  return { value: scopeFallback, invalid: false };
}

export const getActivityReportTool: AssistantTool = {
  definition: {
    type: "function",
    function: {
      name: "get_activity_report",
      description:
        "List logged activities and tags together with the electricity/water usage recorded during their time windows, or aggregate that usage by tag. Results show correlation only -- usage that happened during the activity's window, never proof the activity caused it. Supports a maximum range of 366 days. Use for activities, tags, notes, and 'what happened on <date>' questions.",
      parameters: GetActivityReportSchema
    }
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const fromField = resolveDateField(args.from, context.scope.from);
    const toField = resolveDateField(args.to, context.scope.to);
    const requestedScope = {
      from: typeof args.from === "string" && args.from ? args.from : null,
      to: typeof args.to === "string" && args.to ? args.to : null
    };

    if (fromField.invalid || toField.invalid) {
      return {
        error: "invalid_date_range",
        message: "from and to must be valid ISO dates in YYYY-MM-DD format.",
        requestedScope
      };
    }

    const from = fromField.value;
    const to = toField.value;

    if (!from || !to) {
      return { scope: { from, to }, available: false, reason: "missing_scope", activities: [] };
    }

    if (from > to) {
      return {
        error: "invalid_date_range",
        message: "from must not be after to.",
        requestedScope: { from, to }
      };
    }

    if (inclusiveDayCount(from, to) > MAX_RANGE_DAYS) {
      return {
        error: "activity_range_too_large",
        message: `Activity reports support a maximum range of ${MAX_RANGE_DAYS} days.`,
        requestedScope: { from, to },
        maximumDays: MAX_RANGE_DAYS
      };
    }

    const rawTags = Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const tags = normalizeActivityTags(rawTags.slice(0, MAX_INPUT_TAGS));
    const utility = args.utility === "electricity" || args.utility === "water" ? args.utility : "all";
    const groupBy = args.groupBy === "tag" ? "tag" : "none";
    const includeNotes = args.includeNotes === true;
    const scope = { from, to };

    const { rows, summary } = await loadActivityReport(context.accessToken, { from, to, tags, utility });

    if (groupBy === "tag") {
      return {
        scope,
        tags: groupByTag(rows),
        metadata: {
          correlationOnly: true,
          totalsMayOverlap: true,
          overlapReason: "An activity may contain multiple tags and activity windows may overlap.",
          calculatedFrom: "allMatchedActivities"
        }
      };
    }

    // matchedActivityCount comes from the report-summary RPC, which already
    // scans the complete filtered set independently of the
    // MAX_OUTPUT_ACTIVITIES cap applied below -- so `summary` and this count
    // describe every match, not just the rows sent to the model.
    const matchedActivityCount = summary.activityCount;
    const returnedRows = rows.slice(0, MAX_OUTPUT_ACTIVITIES);

    return {
      scope,
      summary,
      activities: returnedRows.map((row) => mapOccurrence(row, includeNotes)),
      metadata: {
        correlationOnly: true,
        resultLimit: MAX_OUTPUT_ACTIVITIES,
        returnedActivityCount: returnedRows.length,
        matchedActivityCount,
        truncated: rows.length > MAX_OUTPUT_ACTIVITIES
      }
    };
  }
};
