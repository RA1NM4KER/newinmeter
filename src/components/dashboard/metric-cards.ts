import { formatCurrency, formatKl, formatKwh, formatTariff, longDateTime, shortDate } from "@/lib/format";
import { percentChange } from "@/lib/period-comparison";
import type { Analytics } from "@/lib/types";

type MetricCardItem = {
  label: string;
  value: string;
  detail?: string;
  description: string;
  tone?: "neutral" | "good" | "watch" | "danger";
  comparison?: {
    text: string;
    tone: "neutral" | "good" | "watch" | "danger";
  };
};

// Exported so the Data table can colour its own Balance column identically
// (src/components/data/row-formatting.ts), same thresholds everywhere a
// balance number appears, never redefined a second time.
export function getBalanceTone(balance: number) {
  if (balance >= 700) {
    return "good" as const;
  }

  if (balance >= 300) {
    return "watch" as const;
  }

  return "danger" as const;
}

function buildComparison(
  current: number,
  previous: number | undefined,
  higherIsBetter: boolean
): MetricCardItem["comparison"] {
  if (typeof previous !== "number") {
    return undefined;
  }

  const change = percentChange(current, previous);
  if (change === null || change === 0) {
    return undefined;
  }

  const rounded = Math.abs(change) >= 10 ? Math.round(Math.abs(change)) : Math.round(Math.abs(change) * 10) / 10;
  const favorable = higherIsBetter ? change > 0 : change < 0;
  const tone = favorable ? "good" : Math.abs(change) >= 10 ? "danger" : "watch";

  return {
    text: `${change > 0 ? "↑" : "↓"} ${rounded}%`,
    tone
  };
}

export function buildMetricCards(
  metrics: Analytics["metrics"],
  previousMetrics?: Analytics["metrics"]
): MetricCardItem[] {
  const cards: MetricCardItem[] = [
    {
      label: "Latest balance",
      value: typeof metrics.latestBalance === "number" ? formatCurrency(metrics.latestBalance) : "n/a",
      detail: metrics.latestPeriod ? longDateTime(metrics.latestPeriod) : undefined,
      description: "Your most recent LiveMopay balance, as of the last capture.",
      tone: typeof metrics.latestBalance === "number" ? getBalanceTone(metrics.latestBalance) : "neutral"
    },
    {
      label: "Total spend",
      value: formatCurrency(metrics.totalSpend),
      detail: `incl. ${formatCurrency(metrics.totalFixedSpend)} fixed`,
      description: "Everything spent in the selected date range, including fixed charges.",
      comparison: buildComparison(metrics.totalSpend, previousMetrics?.totalSpend, false)
    },
    {
      label: "Total usage",
      value: formatKwh(metrics.totalKwh),
      detail:
        metrics.totalWaterKl > 0
          ? `${formatKwh(metrics.averageKwhPerDay)} electricity/day`
          : `${formatKwh(metrics.averageKwhPerDay)} per day`,
      description: "Total electricity used in the selected date range.",
      comparison: buildComparison(metrics.totalKwh, previousMetrics?.totalKwh, false)
    },
    {
      label: "Electricity rate",
      value: formatTariff(metrics.energyCostPerKwh),
      detail: `${formatTariff(metrics.allInCostPerKwh)} incl. fixed`,
      description: "Your effective cost per kWh, before and after fixed charges are factored in."
    },
    {
      label: "Average spend",
      value: formatCurrency(metrics.averageSpendPerDay),
      detail: `per day, incl. ${formatCurrency(metrics.totalFixedSpend / metrics.dayCount)} fixed`,
      description: "Average daily spend across the selected range, including fixed charges.",
      comparison: buildComparison(metrics.averageSpendPerDay, previousMetrics?.averageSpendPerDay, false)
    },
    {
      label: "Highest spend day",
      value: metrics.highestSpendDay ? formatCurrency(metrics.highestSpendDay.spend) : "n/a",
      detail: metrics.highestSpendDay ? `${shortDate(metrics.highestSpendDay.date)} incl. fixed` : undefined,
      description: "The single day with the highest total spend in the selected range."
    },
    {
      label: "Highest usage day",
      value: metrics.highestUsageDay ? formatKwh(metrics.highestUsageDay.kwh) : "n/a",
      detail: metrics.highestUsageDay ? shortDate(metrics.highestUsageDay.date) : undefined,
      description: "The single day with the highest electricity usage in the selected range."
    },
    {
      label: "Highest usage hour",
      value: metrics.highestUsageHour ? formatKwh(metrics.highestUsageHour.kwh) : "n/a",
      detail: metrics.highestUsageHour
        ? `${metrics.highestUsageHour.date} ${metrics.highestUsageHour.hour} · ${formatCurrency(metrics.highestUsageHour.spend)}`
        : undefined,
      description: "The single 30-minute interval with the highest electricity usage in the selected range."
    }
  ];

  if (metrics.totalWaterSpend > 0 || metrics.totalWaterKl > 0) {
    cards.splice(3, 0, {
      label: "Water spend",
      value: formatCurrency(metrics.totalWaterSpend),
      detail: formatKl(metrics.totalWaterKl),
      description: "Total water charges in the selected date range."
    });

    cards.splice(4, 0, {
      label: "Water usage",
      value: formatKl(metrics.totalWaterKl),
      detail: `${formatKl(metrics.averageWaterKlPerDay)} per day`,
      description: "Total water used in the selected date range."
    });
  }

  return cards;
}
