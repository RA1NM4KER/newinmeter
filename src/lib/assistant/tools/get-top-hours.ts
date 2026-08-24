import { formatCurrency, formatKwh } from "@/lib/format";
import type { Analytics } from "@/lib/types";
import type { AssistantTool } from "../types";
import { GetTopHoursSchema } from "./schemas";

const topHourMetricLabels = {
  kwh: "usage",
  spend: "spend"
} as const;

function summarizeTopHour(metric: "spend" | "kwh", row: Analytics["hourly"][number]) {
  return {
    hour: row.hour,
    spend: row.spend,
    kwh: row.kwh,
    intervals: row.intervals,
    metric,
    metricLabel: topHourMetricLabels[metric],
    metricValue: metric === "spend" ? row.spend : row.kwh,
    metricDisplay: metric === "spend" ? formatCurrency(row.spend) : formatKwh(row.kwh)
  };
}

export const getTopHoursTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_top_hours",
    description: "Get the highest hours in the active range by spend or usage aggregated across the full range.",
    parameters: GetTopHoursSchema,
    strict: true
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const metric = args.metric === "kwh" ? "kwh" : "spend";
    const requestedLimit = typeof args.limit === "number" ? args.limit : Number(args.limit ?? 5);
    const limit = Math.min(10, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 5));
    const rows = context.analytics.hourly
      .slice()
      .sort((left, right) => (metric === "spend" ? right.spend - left.spend : right.kwh - left.kwh))
      .slice(0, limit)
      .map((row) => summarizeTopHour(metric, row));

    return {
      scope: context.scope,
      metric,
      rows
    };
  }
};
