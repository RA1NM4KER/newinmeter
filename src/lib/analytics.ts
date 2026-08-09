import { formatCurrency, formatKl, formatKwh, formatPercent, formatTariff, shortDate } from "./format";
import type {
  Analytics,
  DailyPoint,
  DailyRollupRow,
  HourlyPoint,
  HourlyRollupRow,
  Insight,
  TariffPoint,
  UsageHourPeak
} from "./types";

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

const PROJECTION_ALPHA = 0.2;
const PROJECTION_HISTORY_DAYS = 28;
const MIN_PROJECTION_HISTORY_DAYS = 7;
const MIN_PROJECTION_SLOTS = 12;
const SLOTS_PER_DAY = 48;

type ProjectionComponent = {
  dailyValue: (row: DailyRollupRow) => number;
  dailyIntervals: (row: DailyRollupRow) => number;
  hourlyValue: (row: HourlyRollupRow) => number;
  hourlyIntervals: (row: HourlyRollupRow) => number;
};

const energySpendProjection: ProjectionComponent = {
  dailyValue: (row) => row.energySpend,
  dailyIntervals: (row) => row.energyIntervals,
  hourlyValue: (row) => row.spend,
  hourlyIntervals: (row) => row.intervals
};

const waterSpendProjection: ProjectionComponent = {
  dailyValue: (row) => row.waterSpend,
  dailyIntervals: (row) => row.waterIntervals,
  hourlyValue: (row) => row.waterSpend,
  hourlyIntervals: (row) => row.waterIntervals
};

const energyKwhProjection: ProjectionComponent = {
  dailyValue: (row) => row.energyKwh,
  dailyIntervals: (row) => row.energyIntervals,
  hourlyValue: (row) => row.kwh,
  hourlyIntervals: (row) => row.intervals
};

function median(values: number[]) {
  const sorted = values.slice().sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[midpoint - 1] + sorted[midpoint]) / 2 : sorted[midpoint];
}

function exponentiallyWeightedAverage(values: number[]) {
  return values
    .slice(1)
    .reduce((average, value) => PROJECTION_ALPHA * value + (1 - PROJECTION_ALPHA) * average, values[0]);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function getElapsedHalfHourSlots(periodDate: string, latestPeriod?: string) {
  if (!latestPeriod || !latestPeriod.startsWith(periodDate)) {
    return 0;
  }

  const time = latestPeriod.slice(11, 16);
  const [hourRaw, minuteRaw] = time.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 0;
  }

  return hour * 2 + (minute >= 30 ? 2 : 1);
}

function componentSlots(row: DailyRollupRow, component: ProjectionComponent) {
  const intervals = component.dailyIntervals(row);
  const hasPerFeedCoverage = row.energyIntervals > 0 || row.waterIntervals > 0;
  const resolvedIntervals =
    intervals > 0 ? intervals : hasPerFeedCoverage ? 0 : getElapsedHalfHourSlots(row.periodDate, row.latestPeriod);

  return clamp(resolvedIntervals, 0, SLOTS_PER_DAY);
}

function cumulativeHourlyValue(rows: HourlyRollupRow[], slots: number, component: ProjectionComponent) {
  const completeHours = Math.floor(slots / 2);
  const includesHalfHour = slots % 2 === 1;

  return rows.reduce((total, row) => {
    if (row.hour < completeHours) {
      return total + component.hourlyValue(row);
    }

    if (row.hour !== completeHours || !includesHalfHour) {
      return total;
    }

    const intervalCount = Math.max(1, component.hourlyIntervals(row));
    return total + component.hourlyValue(row) / intervalCount;
  }, 0);
}

function forecastComponent(
  currentRow: DailyRollupRow,
  globalSlots: number,
  historyRows: DailyRollupRow[],
  hourlyByDate: Map<string, HourlyRollupRow[]>,
  component: ProjectionComponent
) {
  const currentValue = component.dailyValue(currentRow);
  const slots = componentSlots(currentRow, component);
  const history = historyRows
    .filter((row) => {
      const intervals = component.dailyIntervals(row);
      return intervals >= SLOTS_PER_DAY || (intervals === 0 && row.isComplete);
    })
    .slice(-PROJECTION_HISTORY_DAYS);

  // New accounts do not have enough history for a stable personal baseline.
  // Retain a coverage-aware fallback, but scale each feed by its own observed
  // slots instead of using another feed's later timestamp.
  if (history.length < MIN_PROJECTION_HISTORY_DAYS) {
    return slots >= MIN_PROJECTION_SLOTS ? (currentValue / slots) * SLOTS_PER_DAY : currentValue;
  }

  const baseline = exponentiallyWeightedAverage(history.map(component.dailyValue));

  // A lagging feed should remain anchored to its historical baseline. It must
  // not be interpreted as genuine zero usage merely because another feed has
  // delivered more recent intervals.
  if (slots < MIN_PROJECTION_SLOTS || baseline <= 0) {
    return Math.max(currentValue, baseline);
  }

  const historicalFractions = history
    .map((row) => {
      const dailyValue = component.dailyValue(row);
      if (dailyValue <= 0) {
        return 0;
      }

      return cumulativeHourlyValue(hourlyByDate.get(row.periodDate) ?? [], slots, component) / dailyValue;
    })
    .filter((fraction) => fraction >= 0.01 && fraction <= 1);

  if (historicalFractions.length < MIN_PROJECTION_HISTORY_DAYS) {
    return Math.max(currentValue, baseline);
  }

  const expectedShare = median(historicalFractions);
  const profileForecast = currentValue / expectedShare;
  // A single unusual partial day must not overwhelm the stable baseline.
  // These guardrails still allow a meaningful adjustment in either direction.
  const guardedProfileForecast = clamp(profileForecast, baseline * 0.45, baseline * 1.75);
  const progress = clamp(globalSlots / SLOTS_PER_DAY, 0, 1);
  const profileWeight = progress ** 1.5;
  const forecast = baseline + (guardedProfileForecast - baseline) * profileWeight;

  return Math.max(currentValue, forecast);
}

function buildProjection(
  row: DailyRollupRow,
  historyRows: DailyRollupRow[],
  hourlyByDate: Map<string, HourlyRollupRow[]>
) {
  const globalSlots = Math.max(
    componentSlots(row, energySpendProjection),
    componentSlots(row, waterSpendProjection),
    getElapsedHalfHourSlots(row.periodDate, row.latestPeriod)
  );

  if (globalSlots < MIN_PROJECTION_SLOTS) {
    return undefined;
  }

  const projectedEnergySpend = forecastComponent(row, globalSlots, historyRows, hourlyByDate, energySpendProjection);
  const projectedWaterSpend = forecastComponent(row, globalSlots, historyRows, hourlyByDate, waterSpendProjection);
  const fixedHistory = historyRows.filter((historyRow) => historyRow.isComplete).slice(-PROJECTION_HISTORY_DAYS);
  const projectedFixedSpend =
    row.fixedSpend > 0 || fixedHistory.length < MIN_PROJECTION_HISTORY_DAYS
      ? row.fixedSpend
      : exponentiallyWeightedAverage(fixedHistory.map((historyRow) => historyRow.fixedSpend));

  return {
    spend: round(Math.max(row.totalSpend, projectedEnergySpend + projectedWaterSpend + projectedFixedSpend)),
    kwh: round(forecastComponent(row, globalSlots, historyRows, hourlyByDate, energyKwhProjection))
  };
}

function maxBy<T>(items: T[], getValue: (item: T) => number) {
  return items.reduce<T | undefined>((best, item) => {
    if (!best || getValue(item) > getValue(best)) {
      return item;
    }

    return best;
  }, undefined);
}

function filterByRange<T extends { periodDate: string }>(rows: T[], from?: string, to?: string) {
  return rows.filter((row) => {
    if (from && row.periodDate < from) {
      return false;
    }

    return !(to && row.periodDate > to);
  });
}

function buildDaily(
  rows: DailyRollupRow[],
  hourlyRows: HourlyRollupRow[] = [],
  projectionDailyRows: DailyRollupRow[] = rows,
  projectionHourlyRows: HourlyRollupRow[] = hourlyRows
): DailyPoint[] {
  let cumulativeSpend = 0;
  const sortedRows = rows.slice().sort((left, right) => left.periodDate.localeCompare(right.periodDate));
  const sortedProjectionRows = projectionDailyRows
    .slice()
    .sort((left, right) => left.periodDate.localeCompare(right.periodDate));
  const latestProjectionDate = sortedProjectionRows[sortedProjectionRows.length - 1]?.periodDate;
  const hourlyByDate = new Map<string, HourlyRollupRow[]>();

  projectionHourlyRows.forEach((row) => {
    const dateRows = hourlyByDate.get(row.periodDate) ?? [];
    dateRows.push(row);
    hourlyByDate.set(row.periodDate, dateRows);
  });

  return sortedRows.map((row) => {
    cumulativeSpend += row.totalSpend;
    const canProject = !row.isComplete && row.periodDate === latestProjectionDate;
    const historyRows = canProject
      ? sortedProjectionRows.filter((historyRow) => historyRow.periodDate < row.periodDate)
      : [];
    const projection = canProject ? buildProjection(row, historyRows, hourlyByDate) : undefined;

    return {
      date: row.periodDate,
      spend: round(row.totalSpend),
      kwh: round(row.energyKwh),
      waterSpend: round(row.waterSpend),
      waterKl: round(row.waterKl),
      averageTariff: round(row.weightedTariff),
      balance: round(row.balanceEnd),
      cumulativeSpend: round(cumulativeSpend),
      energyIntervals: row.energyIntervals,
      waterIntervals: row.waterIntervals,
      isComplete: row.isComplete,
      projectedSpend: projection?.spend,
      projectedKwh: projection?.kwh
    };
  });
}

function buildHourly(rows: HourlyRollupRow[]): HourlyPoint[] {
  const grouped = new Map<number, HourlyRollupRow[]>();

  rows.forEach((row) => {
    const bucket = grouped.get(row.hour) ?? [];
    bucket.push(row);
    grouped.set(row.hour, bucket);
  });

  return Array.from({ length: 24 }, (_, hour) => {
    const items = grouped.get(hour) ?? [];

    return {
      hour: `${String(hour).padStart(2, "0")}:00`,
      spend: round(sum(items.map((item) => item.spend))),
      kwh: round(sum(items.map((item) => item.kwh))),
      waterSpend: round(sum(items.map((item) => item.waterSpend))),
      waterKl: round(sum(items.map((item) => item.waterKl))),
      intervals: sum(items.map((item) => item.intervals)),
      waterIntervals: sum(items.map((item) => item.waterIntervals))
    };
  });
}

function buildHighestUsageHour(rows: HourlyRollupRow[]): UsageHourPeak | undefined {
  const grouped = new Map<string, { spend: number; kwh: number }>();

  rows.forEach((row) => {
    const hour = `${String(row.hour).padStart(2, "0")}:00`;
    const key = `${row.periodDate}|${hour}`;
    const bucket = grouped.get(key) ?? { spend: 0, kwh: 0 };
    bucket.spend += row.spend;
    bucket.kwh += row.kwh;
    grouped.set(key, bucket);
  });

  const hourlyPeaks = Array.from(grouped.entries()).map(([key, item]) => {
    const [date, hour] = key.split("|");

    return {
      date,
      hour,
      spend: round(item.spend),
      kwh: round(item.kwh)
    };
  });

  return maxBy(hourlyPeaks, (item) => item.kwh);
}

function buildDailyTariffTimeline(rows: DailyRollupRow[]): TariffPoint[] {
  return buildDaily(rows)
    .filter((day) => day.kwh > 0)
    .map((day) => ({
      periodDateTime: `${day.date}T00:00`,
      dateLabel: day.date,
      tariff: day.averageTariff,
      chargeLabel: "Daily weighted average",
      spend: day.spend
    }));
}

function buildDailyWaterTariffTimeline(rows: DailyRollupRow[]): TariffPoint[] {
  return buildDaily(rows)
    .filter((day) => day.waterKl > 0)
    .map((day) => ({
      periodDateTime: `${day.date}T00:00`,
      dateLabel: day.date,
      tariff: round(day.waterSpend / day.waterKl),
      chargeLabel: "Daily weighted average",
      spend: day.waterSpend
    }));
}

function previousTrend(daily: DailyPoint[]) {
  const midpoint = Math.floor(daily.length / 2);
  const previous = daily.slice(0, midpoint);
  const recent = daily.slice(midpoint);

  if (!previous.length || !recent.length) {
    return undefined;
  }

  const previousAverage = sum(previous.map((day) => day.spend)) / previous.length;
  const recentAverage = sum(recent.map((day) => day.spend)) / recent.length;

  if (previousAverage === 0) {
    return undefined;
  }

  return ((recentAverage - previousAverage) / previousAverage) * 100;
}

function buildInsights(
  dailyRows: DailyRollupRow[],
  daily: DailyPoint[],
  hourly: HourlyPoint[],
  tariffTimeline: TariffPoint[]
): Insight[] {
  const fixedSpend = sum(dailyRows.map((day) => day.fixedSpend));
  const waterSpend = sum(dailyRows.map((day) => day.waterSpend));
  const waterKl = sum(dailyRows.map((day) => day.waterKl));
  const topSpendHour = maxBy(hourly, (hour) => hour.spend);
  const totalSpend = sum(hourly.map((hour) => hour.spend));
  const topHours = hourly
    .slice()
    .sort((left, right) => right.spend - left.spend)
    .slice(0, 3);
  const topHourShare = totalSpend > 0 ? sum(topHours.map((hour) => hour.spend)) / totalSpend : 0;
  const trend = previousTrend(daily);
  const highestSpendDay = maxBy(daily, (day) => day.spend);
  const highestTariff = maxBy(dailyRows, (row) => row.peakTariff);

  const insights: Insight[] = [];

  // `hourly` always has all 24 hours (buildHourly zero-pads it for the
  // chart's x-axis), so maxBy always returns something even when there's no
  // real activity at all -- guard on actual spend, not just truthiness, or
  // an empty range surfaces a fabricated "00:00 is your most expensive
  // hour at R0.00" insight.
  if (topSpendHour && topSpendHour.spend > 0) {
    insights.push({
      title: "Energy cost pressure",
      body: `${topSpendHour.hour} is your most expensive energy hour at ${formatCurrency(topSpendHour.spend)} across this range.`
    });
  }

  if (topHours.length && totalSpend > 0) {
    insights.push({
      title: "Concentration",
      body: `The top three hours carry ${Math.round(topHourShare * 100)}% of spend: ${topHours.map((hour) => hour.hour).join(", ")}.`,
      tone: topHourShare > 0.4 ? "watch" : "neutral"
    });
  }

  if (typeof trend === "number") {
    insights.push({
      title: "Recent trend",
      body: `Recent daily spend is ${formatPercent(trend)} versus the previous comparable slice.`,
      tone: trend > 10 ? "watch" : trend < -10 ? "good" : "neutral"
    });
  }

  if (highestSpendDay) {
    insights.push({
      title: "Peak day",
      body: `${shortDate(highestSpendDay.date)} led spend at ${formatCurrency(highestSpendDay.spend)} from ${formatKwh(highestSpendDay.kwh)}.`
    });
  }

  if (tariffTimeline.length > 1 && highestTariff) {
    insights.push({
      title: "Tariff movement",
      body: `${tariffTimeline.length} tariff band changes appear in range. Highest observed tariff is ${formatTariff(highestTariff.peakTariff)}.`
    });
  }

  if (fixedSpend > 0) {
    insights.push({
      title: "Fixed charges",
      body: `${formatCurrency(fixedSpend)} came from daily fixed charges. This is included in spend, not kWh usage.`
    });
  }

  if (waterSpend > 0 || waterKl > 0) {
    insights.push({
      title: "Water charges",
      body: `${formatCurrency(waterSpend)} came from ${formatKl(waterKl)} of metered water usage in this range.`
    });
  }

  return insights;
}

export function createAnalytics(
  dailyRows: DailyRollupRow[],
  hourlyRows: HourlyRollupRow[],
  from?: string,
  to?: string,
  latestSummary?: { latestBalance?: number; latestPeriod?: string }
): Analytics {
  const filteredDailyRows = filterByRange(dailyRows, from, to);
  const filteredHourlyRows = filterByRange(hourlyRows, from, to);
  const daily = buildDaily(filteredDailyRows, filteredHourlyRows, dailyRows, hourlyRows);
  const hourly = buildHourly(filteredHourlyRows);
  const tariffTimeline = buildDailyTariffTimeline(filteredDailyRows);
  const waterTariffTimeline = buildDailyWaterTariffTimeline(filteredDailyRows);
  const totalSpend = round(sum(filteredDailyRows.map((row) => row.totalSpend)));
  const totalEnergySpend = round(sum(filteredDailyRows.map((row) => row.energySpend)));
  const totalWaterSpend = round(sum(filteredDailyRows.map((row) => row.waterSpend)));
  const totalFixedSpend = round(sum(filteredDailyRows.map((row) => row.fixedSpend)));
  const totalKwh = round(sum(filteredDailyRows.map((row) => row.energyKwh)));
  const totalWaterKl = round(sum(filteredDailyRows.map((row) => row.waterKl)));
  const energyCostPerKwh = totalKwh > 0 ? round(totalEnergySpend / totalKwh) : 0;
  const allInCostPerKwh = totalKwh > 0 ? round((totalEnergySpend + totalFixedSpend) / totalKwh) : 0;
  const dayCount = daily.length || 1;
  const highestSpendDay = maxBy(daily, (day) => day.spend);
  const highestUsageDay = maxBy(daily, (day) => day.kwh);
  const highestWaterDay = maxBy(daily, (day) => day.waterKl);
  const highestUsageHour = buildHighestUsageHour(filteredHourlyRows);
  const latest = filteredDailyRows[filteredDailyRows.length - 1];

  return {
    daily,
    hourly,
    tariffTimeline,
    waterTariffTimeline,
    metrics: {
      totalSpend,
      totalEnergySpend,
      totalWaterSpend,
      totalFixedSpend,
      totalKwh,
      totalWaterKl,
      energyCostPerKwh,
      allInCostPerKwh,
      averageSpendPerDay: round(totalSpend / dayCount),
      averageKwhPerDay: round(totalKwh / dayCount),
      averageWaterKlPerDay: round(totalWaterKl / dayCount),
      highestSpendDay,
      highestUsageDay,
      highestWaterDay,
      highestUsageHour,
      latestBalance: latestSummary?.latestBalance ?? latest?.balanceEnd,
      latestPeriod: latestSummary?.latestPeriod ?? latest?.latestPeriod,
      dateStart: daily[0]?.date,
      dateEnd: daily[daily.length - 1]?.date,
      dayCount
    },
    insights: buildInsights(filteredDailyRows, daily, hourly, tariffTimeline)
  };
}
