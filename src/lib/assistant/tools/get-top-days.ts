import { formatCurrency, formatKl, formatKwh, formatTariff } from "@/lib/format";
import type { Analytics } from "@/lib/types";
import type { AssistantTool } from "../types";
import { GetTopDaysSchema } from "./schemas";

type TopDayMetric = "spend" | "kwh" | "tariff" | "waterKl" | "waterSpend";

const topDayMetricLabels: Record<TopDayMetric, string> = {
  kwh: "usage",
  spend: "spend",
  tariff: "tariff",
  waterKl: "water usage",
  waterSpend: "water spend"
};

// Water metrics are zero on most days for accounts without (or with only
// occasional) water charges. Ranking on a metric that's mostly zero would
// otherwise pad the "top" list with tied zero-value days instead of
// reporting only days that actually had water activity.
const zeroFilteredMetrics = new Set<TopDayMetric>(["waterKl", "waterSpend"]);

function metricValueOf(metric: TopDayMetric, row: Analytics["daily"][number]) {
  switch (metric) {
    case "spend":
      return row.spend;
    case "kwh":
      return row.kwh;
    case "tariff":
      return row.averageTariff;
    case "waterKl":
      return row.waterKl;
    case "waterSpend":
      return row.waterSpend;
  }
}

function metricDisplayOf(metric: TopDayMetric, value: number) {
  switch (metric) {
    case "spend":
      return formatCurrency(value);
    case "kwh":
      return formatKwh(value);
    case "tariff":
      return formatTariff(value);
    case "waterKl":
      return formatKl(value);
    case "waterSpend":
      return formatCurrency(value);
  }
}

function summarizeTopDay(metric: TopDayMetric, row: Analytics["daily"][number]) {
  const metricValue = metricValueOf(metric, row);

  return {
    date: row.date,
    spend: row.spend,
    kwh: row.kwh,
    waterSpend: row.waterSpend,
    waterKl: row.waterKl,
    averageTariff: row.averageTariff,
    balance: row.balance,
    metric,
    metricLabel: topDayMetricLabels[metric],
    metricValue,
    metricDisplay: metricDisplayOf(metric, metricValue)
  };
}

const validMetrics = new Set<TopDayMetric>(["spend", "kwh", "tariff", "waterKl", "waterSpend"]);

export const getTopDaysTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_top_days",
    description:
      "Get the highest days in the active range by spend, electricity usage, average tariff, water usage, or water spend. For water metrics, only days with nonzero water activity are ranked.",
    parameters: GetTopDaysSchema,
    strict: true
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const metric: TopDayMetric =
      typeof args.metric === "string" && validMetrics.has(args.metric as TopDayMetric)
        ? (args.metric as TopDayMetric)
        : "spend";
    const requestedLimit = typeof args.limit === "number" ? args.limit : Number(args.limit ?? 5);
    const limit = Math.min(10, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 5));
    const eligibleDays = zeroFilteredMetrics.has(metric)
      ? context.analytics.daily.filter((day) => metricValueOf(metric, day) > 0)
      : context.analytics.daily;
    const rows = eligibleDays
      .slice()
      .sort((left, right) => metricValueOf(metric, right) - metricValueOf(metric, left))
      .slice(0, limit)
      .map((row) => summarizeTopDay(metric, row));

    return {
      scope: context.scope,
      metric,
      rows
    };
  }
};
