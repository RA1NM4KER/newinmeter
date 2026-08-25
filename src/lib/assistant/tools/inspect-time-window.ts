import { loadActivityReport } from "@/lib/activity/data";
import { activityOverlapsRange, isHalfHourTime, isIsoDate } from "@/lib/activity/utils";
import { loadDayIntervalRollups } from "@/lib/dashboard-data";
import type { AssistantTool } from "../types";
import { InspectTimeWindowSchema } from "./schemas";

// Answers "what happened around <time>" questions directly against the
// REQUESTED window, instead of only ever summarizing the whole day (see
// explain_day, which stays day-scoped) -- ranges over real half-hour
// interval rollups, never invented numbers.
const MIN_COMPARISON_DAYS = 5;
const MAX_COMPARISON_DAYS = 60;

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function toMinuteOffset(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// periodTime is the half-hour slot's OWN start ("19:00" covers 19:00-19:30);
// a slot is "in window" when its start falls in [startTime, endTime).
function isInWindow(periodTime: string, startTime: string, endTimeExclusive: string): boolean {
  const start = toMinuteOffset(startTime);
  const end = endTimeExclusive === "00:00" ? 24 * 60 : toMinuteOffset(endTimeExclusive);
  const slot = toMinuteOffset(periodTime);
  return slot >= start && slot < end;
}

export const inspectTimeWindowTool: AssistantTool = {
  definition: {
    type: "function",
    name: "inspect_time_window",
    description:
      "Complete answer source for a SPECIFIC time window on a specific day (e.g. 'what happened around 7pm?'), including exact interval data and Activity overlaps. Use this instead of explain_day/get_top_hours when the user names a time; do not fetch whole-day context unless explicitly requested.",
    parameters: InspectTimeWindowSchema,
    strict: true
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const date = typeof args.date === "string" ? args.date : "";
    const startTime = typeof args.startTime === "string" ? args.startTime : "";
    const endTime = typeof args.endTime === "string" ? args.endTime : "";

    if (!isIsoDate(date)) {
      return { error: "invalid_date", message: "date must be a valid ISO date in YYYY-MM-DD format." };
    }
    if (!isHalfHourTime(startTime)) {
      return { error: "invalid_time", message: "startTime must be a half-hour-aligned HH:MM." };
    }
    if (!(isHalfHourTime(endTime) || endTime === "00:00")) {
      return { error: "invalid_time", message: "endTime must be a half-hour-aligned HH:MM or '00:00'." };
    }
    if (toMinuteOffset(startTime) >= (endTime === "00:00" ? 24 * 60 : toMinuteOffset(endTime))) {
      return { error: "invalid_time_range", message: "startTime must be before endTime." };
    }

    const day = context.dailyRows.find((row) => row.periodDate === date);
    const intervals = await loadDayIntervalRollups(context.accessToken, date);
    const windowIntervals = intervals.filter((interval) => isInWindow(interval.periodTime, startTime, endTime));

    const windowTotals = windowIntervals.reduce(
      (acc, interval) => ({
        kwh: acc.kwh + interval.kwh,
        spend: acc.spend + interval.spend,
        waterKl: acc.waterKl + interval.waterKl,
        waterSpend: acc.waterSpend + interval.waterSpend
      }),
      { kwh: 0, spend: 0, waterKl: 0, waterSpend: 0 }
    );

    // A little surrounding context (up to 1 hour either side of the
    // requested window) so the answer can note e.g. "usage was already
    // climbing before 19:00" without re-running a second tool call.
    const paddedStart = Math.max(0, toMinuteOffset(startTime) - 60);
    const paddedEnd = Math.min(24 * 60, (endTime === "00:00" ? 24 * 60 : toMinuteOffset(endTime)) + 60);
    const nearbyIntervals = intervals
      .filter((interval) => {
        const slot = toMinuteOffset(interval.periodTime);
        return slot >= paddedStart && slot < paddedEnd && !isInWindow(interval.periodTime, startTime, endTime);
      })
      .map((interval) => ({ time: interval.periodTime, kwh: round2(interval.kwh), spend: round2(interval.spend) }));

    let overlappingActivities: Array<{ startsAt: string; endsAt: string; tags: string[] }> = [];
    if (context.permissions.activitiesEnabled) {
      try {
        const { rows } = await loadActivityReport(context.accessToken, { from: date, to: date, utility: "all" });
        const windowStartsAt = `${date}T${startTime}:00`;
        const windowEndsAt = endTime === "00:00" ? `${date}T24:00:00` : `${date}T${endTime}:00`;
        overlappingActivities = rows
          .filter((row) => activityOverlapsRange(row.startsAt, row.endsAt, windowStartsAt, windowEndsAt))
          .map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt, tags: row.tags }));
      } catch {
        overlappingActivities = [];
      }
    }

    // Typical-same-time comparison: average of the SAME time-of-day window
    // across other COMPLETE days already in dailyRows (never a fresh fetch
    // of extra history) -- only offered once there's enough real history to
    // be meaningful, and always says how many days it's based on.
    let typicalComparison: { averageKwh: number; averageSpend: number; basedOnDays: number } | null = null;
    if (args.includeTypicalComparison !== false) {
      const completeDates = context.dailyRows
        .filter((row) => row.isComplete && row.periodDate !== date)
        .map((row) => row.periodDate)
        .slice(-MAX_COMPARISON_DAYS);

      if (completeDates.length >= MIN_COMPARISON_DAYS) {
        const comparisonIntervals = await Promise.all(
          completeDates.map((comparisonDate) => loadDayIntervalRollups(context.accessToken, comparisonDate))
        );
        const perDayTotals = comparisonIntervals.map((dayIntervals) =>
          dayIntervals
            .filter((interval) => isInWindow(interval.periodTime, startTime, endTime))
            .reduce((acc, interval) => ({ kwh: acc.kwh + interval.kwh, spend: acc.spend + interval.spend }), {
              kwh: 0,
              spend: 0
            })
        );
        typicalComparison = {
          averageKwh: round2(perDayTotals.reduce((sum, day) => sum + day.kwh, 0) / perDayTotals.length),
          averageSpend: round2(perDayTotals.reduce((sum, day) => sum + day.spend, 0) / perDayTotals.length),
          basedOnDays: perDayTotals.length
        };
      }
    }

    return {
      date,
      window: { startTime, endTime },
      dayComplete: day?.isComplete ?? false,
      window_kwh: round2(windowTotals.kwh),
      window_spend: round2(windowTotals.spend),
      window_waterKl: round2(windowTotals.waterKl),
      window_waterSpend: round2(windowTotals.waterSpend),
      intervals: windowIntervals.map((interval) => ({
        time: interval.periodTime,
        kwh: round2(interval.kwh),
        spend: round2(interval.spend)
      })),
      nearbyIntervals,
      overlappingActivities,
      typicalComparison,
      metadata: { correlationOnly: true }
    };
  }
};
