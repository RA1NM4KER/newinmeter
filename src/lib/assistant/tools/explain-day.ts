import { loadDayIntervalRollups } from "@/lib/dashboard-data";
import type { AssistantTool } from "../types";
import { ExplainDaySchema } from "./schemas";

export const explainDayTool: AssistantTool = {
  definition: {
    type: "function",
    name: "explain_day",
    description: "Explain one specific day using its daily rollup and top half-hour intervals.",
    parameters: ExplainDaySchema,
    strict: true
  },
  handler: async (args, getContext) => {
    const context = await getContext();
    const date = typeof args.date === "string" && args.date ? args.date : context.scope.to;
    const day = context.dailyRows.find((row) => row.periodDate === date);

    if (!day) {
      return {
        scope: context.scope,
        date,
        found: false
      };
    }

    const intervals = await loadDayIntervalRollups(context.accessToken, date);
    const topSpendIntervals = intervals
      .slice()
      .sort((left, right) => right.spend - left.spend)
      .slice(0, 6)
      .map((interval) => ({
        time: interval.periodTime,
        spend: interval.spend,
        kwh: interval.kwh
      }));
    const topUsageIntervals = intervals
      .slice()
      .sort((left, right) => right.kwh - left.kwh)
      .slice(0, 6)
      .map((interval) => ({
        time: interval.periodTime,
        spend: interval.spend,
        kwh: interval.kwh
      }));
    const topWaterIntervals = intervals
      .slice()
      .sort((left, right) => right.waterSpend - left.waterSpend)
      .slice(0, 6)
      .map((interval) => ({
        time: interval.periodTime,
        waterSpend: interval.waterSpend,
        waterKl: interval.waterKl
      }));

    return {
      scope: context.scope,
      date,
      found: true,
      day,
      topSpendIntervals,
      topUsageIntervals,
      topWaterIntervals
    };
  }
};
