import type { AssistantTool, DashboardContext } from "../types";
import { EmptySchema } from "./schemas";

function buildOverview(context: DashboardContext) {
  const metrics = context.analytics.metrics;
  const incompleteDays = context.analytics.daily.filter((day) => !day.isComplete).length;

  return {
    scope: context.scope,
    metrics,
    highlights: {
      highestSpendDay: metrics.highestSpendDay ?? null,
      highestUsageDay: metrics.highestUsageDay ?? null,
      highestUsageHour: metrics.highestUsageHour ?? null
    },
    incompleteDays,
    insights: context.analytics.insights
  };
}

export const getScopeOverviewTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_scope_overview",
    description: "Get the main totals, peaks, balance, and generated insights for the active dashboard date range.",
    parameters: EmptySchema,
    strict: true
  },
  handler: async (_args, getContext) => buildOverview(await getContext())
};
