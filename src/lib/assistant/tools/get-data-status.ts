import { loadLatestCaptureRun } from "@/lib/energy-data";
import type { AssistantTool } from "../types";
import { GetDataStatusSchema } from "./schemas";

// Mirrors energy_day_rollups.is_complete (see supabase/migrations/*_livenopay_rollups.sql
// and friends): a day is "complete" when it has 48 distinct half-hour energy
// intervals. Reused here only to explain the heuristic below, not to
// recompute isComplete -- the isComplete flag on each daily row remains the
// single source of truth for completeness.
const EXPECTED_ENERGY_INTERVALS_PER_DAY = 48;

export const getDataStatusTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_data_status",
    description:
      "Report data sync freshness and completeness: when data last synced, whether the most recent sync attempt failed, whether the latest day is fully captured, which dates are incomplete, and dates with suspected interval gaps. Use this for questions about data being partial, stale, or missing -- not for usage or spend questions.",
    parameters: GetDataStatusSchema,
    strict: true
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const requestedLimit = typeof args.limit === "number" ? args.limit : Number(args.limit ?? 10);
    const limit = Math.min(30, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 10));

    const allDaily = context.dailyRows;
    const latestDate =
      context.summary.dateEnd ??
      allDaily
        .slice()
        .sort((left, right) => left.periodDate.localeCompare(right.periodDate))
        .at(-1)?.periodDate;
    const latestDayRow = latestDate ? allDaily.find((row) => row.periodDate === latestDate) : undefined;

    const incompleteDays = allDaily
      .filter((row) => !row.isComplete)
      .sort((left, right) => right.periodDate.localeCompare(left.periodDate));

    // A day at the very end of the known history is normally still partial
    // because it hasn't finished accruing yet -- that's expected, not a gap.
    // Anything incomplete *and* short of the expected interval count that
    // isn't the latest date is more likely a real hole in imported data.
    const possibleGapDays = incompleteDays.filter(
      (row) => row.periodDate !== latestDate && row.energyIntervals < EXPECTED_ENERGY_INTERVALS_PER_DAY
    );

    const latestCaptureRun = await loadLatestCaptureRun(context.accessToken);

    return {
      scope: context.scope,
      lastSyncedAt: context.summary.lastSyncedAt ?? null,
      rowsInCsv: context.summary.rowsInCsv ?? null,
      rowsSynced: context.summary.rowsSynced ?? null,
      latestPeriod: context.summary.latestPeriod ?? null,
      latestDate: latestDate ?? null,
      latestDateComplete: latestDayRow ? latestDayRow.isComplete : null,
      incompleteDateCount: incompleteDays.length,
      incompleteDates: incompleteDays.slice(0, limit).map((row) => row.periodDate),
      possibleGapDateCount: possibleGapDays.length,
      possibleGapDates: possibleGapDays.slice(0, limit).map((row) => row.periodDate),
      gapDetectionRule:
        "energyIntervalsBelowExpectedAndNotLatestDate: flags a day as a possible gap (not a proven one) when it has fewer than 48 half-hour energy intervals and is not the most recent captured date.",
      // Never forward the raw stored error string -- it can carry internal
      // host/network/DB/auth detail from the sync worker. The model only
      // needs to know whether the latest attempt failed, not why.
      latestCaptureRun: latestCaptureRun
        ? {
            status: latestCaptureRun.status,
            startedAt: latestCaptureRun.startedAt,
            finishedAt: latestCaptureRun.finishedAt,
            errorPresent: Boolean(latestCaptureRun.error),
            safeErrorMessage: latestCaptureRun.status === "failed" ? "The latest sync attempt failed." : null
          }
        : null
    };
  }
};
