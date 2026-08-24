import { formatCurrency, formatKl, formatKwh, formatTariff } from "@/lib/format";
import type { DailyRollupRow } from "@/lib/types";
import type { AssistantTool } from "../types";
import { EmptySchema } from "./schemas";

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(2)) : 0;
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(month: string) {
  const [year, rawMonth] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const index = Number(rawMonth) - 1;
  return `${names[index] ?? rawMonth} ${year}`;
}

function buildMonthlyBreakdown(rows: DailyRollupRow[]) {
  const byMonth = new Map<
    string,
    {
      month: string;
      from: string;
      to: string;
      spend: number;
      energySpend: number;
      waterSpend: number;
      fixedSpend: number;
      kwh: number;
      waterKl: number;
      topups: number;
      latestBalance: number;
      days: number;
    }
  >();

  for (const row of rows) {
    const key = monthKey(row.periodDate);
    const bucket = byMonth.get(key) ?? {
      month: key,
      from: row.periodDate,
      to: row.periodDate,
      spend: 0,
      energySpend: 0,
      waterSpend: 0,
      fixedSpend: 0,
      kwh: 0,
      waterKl: 0,
      topups: 0,
      latestBalance: row.balanceEnd,
      days: 0
    };

    bucket.from = row.periodDate < bucket.from ? row.periodDate : bucket.from;
    bucket.to = row.periodDate > bucket.to ? row.periodDate : bucket.to;
    bucket.spend += row.totalSpend;
    bucket.energySpend += row.energySpend;
    bucket.waterSpend += row.waterSpend;
    bucket.fixedSpend += row.fixedSpend;
    bucket.kwh += row.energyKwh;
    bucket.waterKl += row.waterKl;
    bucket.topups += row.topupAmount;
    bucket.latestBalance = row.balanceEnd;
    bucket.days += 1;
    byMonth.set(key, bucket);
  }

  return Array.from(byMonth.values())
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((item) => ({
      month: item.month,
      label: monthLabel(item.month),
      from: item.from,
      to: item.to,
      spend: Number(item.spend.toFixed(2)),
      spendDisplay: formatCurrency(item.spend),
      energySpend: Number(item.energySpend.toFixed(2)),
      energySpendDisplay: formatCurrency(item.energySpend),
      waterSpend: Number(item.waterSpend.toFixed(2)),
      waterSpendDisplay: formatCurrency(item.waterSpend),
      fixedSpend: Number(item.fixedSpend.toFixed(2)),
      fixedSpendDisplay: formatCurrency(item.fixedSpend),
      kwh: Number(item.kwh.toFixed(2)),
      kwhDisplay: formatKwh(item.kwh),
      waterKl: Number(item.waterKl.toFixed(2)),
      waterKlDisplay: formatKl(item.waterKl),
      topups: Number(item.topups.toFixed(2)),
      topupsDisplay: formatCurrency(item.topups),
      latestBalance: Number(item.latestBalance.toFixed(2)),
      latestBalanceDisplay: formatCurrency(item.latestBalance),
      dayCount: item.days,
      averageSpendPerDay: Number((item.spend / Math.max(1, item.days)).toFixed(2)),
      averageSpendPerDayDisplay: formatCurrency(item.spend / Math.max(1, item.days)),
      averageKwhPerDay: Number((item.kwh / Math.max(1, item.days)).toFixed(2)),
      averageKwhPerDayDisplay: formatKwh(item.kwh / Math.max(1, item.days)),
      energyCostPerKwh: safeDivide(item.energySpend, item.kwh),
      energyCostPerKwhDisplay: formatTariff(safeDivide(item.energySpend, item.kwh)),
      allInCostPerKwh: safeDivide(item.spend, item.kwh),
      allInCostPerKwhDisplay: formatTariff(safeDivide(item.spend, item.kwh))
    }));
}

export const compareCalendarMonthsTool: AssistantTool = {
  definition: {
    type: "function",
    name: "compare_calendar_months",
    description:
      "Compare the latest calendar month in scope against the previous calendar month in scope (e.g. 'this month vs last month'), including cost-per-kWh rates. Use compare_previous_period instead for an immediately preceding range of equal length that is not calendar-month aligned (e.g. 'the last 7 days vs the 7 days before that').",
    parameters: EmptySchema,
    strict: true
  },
  handler: async (_args, getContext) => {
    const context = await getContext();
    const months = buildMonthlyBreakdown(
      context.dailyRows.filter((row) => {
        if (context.scope.from && row.periodDate < context.scope.from) {
          return false;
        }

        return !(context.scope.to && row.periodDate > context.scope.to);
      })
    );

    const current = months[months.length - 1] ?? null;
    const previous = months[months.length - 2] ?? null;

    return {
      scope: context.scope,
      months,
      current,
      previous,
      deltas:
        current && previous
          ? {
              spend: Number((current.spend - previous.spend).toFixed(2)),
              kwh: Number((current.kwh - previous.kwh).toFixed(2)),
              waterSpend: Number((current.waterSpend - previous.waterSpend).toFixed(2)),
              waterKl: Number((current.waterKl - previous.waterKl).toFixed(2)),
              averageSpendPerDay: Number((current.averageSpendPerDay - previous.averageSpendPerDay).toFixed(2)),
              averageKwhPerDay: Number((current.averageKwhPerDay - previous.averageKwhPerDay).toFixed(2)),
              topups: Number((current.topups - previous.topups).toFixed(2)),
              latestBalance: Number((current.latestBalance - previous.latestBalance).toFixed(2)),
              energyCostPerKwh: Number((current.energyCostPerKwh - previous.energyCostPerKwh).toFixed(2)),
              allInCostPerKwh: Number((current.allInCostPerKwh - previous.allInCostPerKwh).toFixed(2))
            }
          : null
    };
  }
};
