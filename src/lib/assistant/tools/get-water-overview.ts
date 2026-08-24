import { formatCurrency, formatKl } from "@/lib/format";
import type { AssistantTool } from "../types";
import { EmptySchema } from "./schemas";

function hasWaterCharge(day: { waterSpend: number; waterKl: number }) {
  return day.waterSpend > 0 || day.waterKl > 0;
}

export const getWaterOverviewTool: AssistantTool = {
  definition: {
    type: "function",
    name: "get_water_overview",
    description:
      "Summarize water charges in the active dashboard range, including when they first appeared and the highest water day.",
    parameters: EmptySchema,
    strict: true
  },
  handler: async (_args, getContext) => {
    const context = await getContext();
    const scopedDaily = context.analytics.daily;
    const allDaily = context.dailyRows.slice().sort((left, right) => left.periodDate.localeCompare(right.periodDate));
    const firstWaterDayAllTime = allDaily.find(hasWaterCharge);
    const firstWaterDayInScope = scopedDaily.find(hasWaterCharge);
    const waterChargeDays = scopedDaily.filter(hasWaterCharge).length;
    const totalWaterSpend = context.analytics.metrics.totalWaterSpend;
    const totalWaterKl = context.analytics.metrics.totalWaterKl;
    const averageWaterSpendPerDay =
      scopedDaily.length > 0 ? Number((totalWaterSpend / scopedDaily.length).toFixed(2)) : 0;

    return {
      scope: context.scope,
      firstWaterCharge: firstWaterDayAllTime
        ? {
            date: firstWaterDayAllTime.periodDate,
            waterSpend: firstWaterDayAllTime.waterSpend,
            waterKl: firstWaterDayAllTime.waterKl
          }
        : null,
      firstWaterChargeInScope: firstWaterDayInScope
        ? {
            date: firstWaterDayInScope.date,
            waterSpend: firstWaterDayInScope.waterSpend,
            waterKl: firstWaterDayInScope.waterKl
          }
        : null,
      waterChargeDays,
      totalWaterSpend,
      totalWaterKl,
      averageWaterSpendPerDay,
      averageWaterKlPerDay: context.analytics.metrics.averageWaterKlPerDay,
      highestWaterDay: context.analytics.metrics.highestWaterDay
        ? {
            date: context.analytics.metrics.highestWaterDay.date,
            waterSpend: context.analytics.metrics.highestWaterDay.waterSpend,
            waterKl: context.analytics.metrics.highestWaterDay.waterKl
          }
        : null,
      formatted: {
        totalWaterSpend: formatCurrency(totalWaterSpend),
        totalWaterKl: formatKl(totalWaterKl),
        averageWaterSpendPerDay: formatCurrency(averageWaterSpendPerDay)
      }
    };
  }
};
