import type { AssistantTool } from "../types";
import { EmptySchema } from "./schemas";

const dayMs = 86_400_000;

function parseIsoDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function endOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

export const getBalanceRunoutTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_balance_runout",
    description:
      "Estimate when the current balance runs out at the average daily spend, and whether it covers the end of the month.",
    parameters: EmptySchema,
    strict: true
  },
  handler: async (_args, getContext) => {
    const context = await getContext();
    const metrics = context.analytics.metrics;
    const asOfDate = metrics.dateEnd ?? context.scope.to;

    if (!asOfDate) {
      return {
        scope: context.scope,
        available: false,
        reason: "missing_date"
      };
    }

    if (typeof metrics.latestBalance !== "number" || !Number.isFinite(metrics.latestBalance)) {
      return {
        scope: context.scope,
        asOfDate,
        available: false,
        reason: "missing_balance"
      };
    }

    if (!Number.isFinite(metrics.averageSpendPerDay) || metrics.averageSpendPerDay <= 0) {
      return {
        scope: context.scope,
        asOfDate,
        available: false,
        reason: "missing_average_spend"
      };
    }

    const daysRemaining = metrics.latestBalance / metrics.averageSpendPerDay;
    const runoutAt = new Date(parseIsoDate(asOfDate).getTime() + daysRemaining * dayMs);
    const monthEnd = endOfMonth(parseIsoDate(asOfDate));

    return {
      scope: context.scope,
      asOfDate,
      available: true,
      latestBalance: metrics.latestBalance,
      averageSpendPerDay: metrics.averageSpendPerDay,
      daysRemaining: Number(daysRemaining.toFixed(1)),
      runoutDate: formatIsoDate(runoutAt),
      monthEnd: formatIsoDate(monthEnd),
      coversMonthEnd: runoutAt.getTime() >= monthEnd.getTime()
    };
  }
};
