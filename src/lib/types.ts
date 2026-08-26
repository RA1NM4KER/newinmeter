export type EnergyRow = {
  chargeKind: "energy" | "water" | "fixed" | "topup" | "refund";
  captureTimestamp: number;
  captureDateTime: string;
  ledgerTimestamp: number;
  chargeLabel: string;
  tariffBand: string | null;
  periodTimestamp: number;
  periodDateTime: string;
  periodDate: string;
  periodTime: string;
  hour: number;
  kwh: number;
  waterKl: number;
  usageAmount: number;
  usageUnit: "kWh" | "kL" | null;
  tariff: number;
  cost: number;
  balance: number;
};

export type SyncMetadata = {
  lastSyncedAt?: string;
  rowsInCsv?: number;
  rowsSynced?: number;
};

export type DashboardSummary = SyncMetadata & {
  dateStart?: string;
  dateEnd?: string;
  latestBalance?: number;
  latestPeriod?: string;
  maxIntervalSpend?: number;
  maxIntervalKwh?: number;
  maxWaterIntervalSpend?: number;
  maxWaterIntervalKl?: number;
};

export type QuickRange = "pastWeek" | "pastMonth" | "past3Months" | "thisMonth" | "thisWeek" | "allTime" | "custom";

export type DailyPoint = {
  date: string;
  spend: number;
  kwh: number;
  waterSpend: number;
  waterKl: number;
  averageTariff: number;
  balance: number;
  cumulativeSpend: number;
  energyIntervals: number;
  waterIntervals: number;
  isComplete: boolean;
  projectedSpend?: number;
  projectedKwh?: number;
};

export type HourlyPoint = {
  hour: string;
  spend: number;
  kwh: number;
  waterSpend: number;
  waterKl: number;
  intervals: number;
  waterIntervals: number;
};

export type UsageHourPeak = {
  date: string;
  hour: string;
  spend: number;
  kwh: number;
};

export type DailyRollupRow = {
  periodDate: string;
  energySpend: number;
  waterSpend: number;
  fixedSpend: number;
  topupAmount: number;
  totalSpend: number;
  energyKwh: number;
  waterKl: number;
  weightedTariff: number;
  peakTariff: number;
  allInRate: number;
  balanceEnd: number;
  latestPeriod?: string;
  energyIntervals: number;
  waterIntervals: number;
  isComplete: boolean;
};

export type HourlyRollupRow = {
  periodDate: string;
  hour: number;
  spend: number;
  kwh: number;
  waterSpend: number;
  waterKl: number;
  intervals: number;
  waterIntervals: number;
};

export type IntervalRollupRow = {
  periodDate: string;
  periodTime: string;
  spend: number;
  kwh: number;
  waterSpend: number;
  waterKl: number;
};

export type UsageActivity = {
  id: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  tags: string[];
  color: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type ActivityReportRow = UsageActivity & {
  date: string;
  durationMinutes: number;
  electricityKwh: number;
  averageKw: number;
  electricitySpend: number;
  waterKl: number;
  waterSpend: number;
};

export type ActivityReportSummary = {
  activityCount: number;
  taggedDurationMinutes: number;
  electricityKwh: number;
  averageElectricityKwhPerActivity: number;
  electricitySpend: number;
  waterKl: number;
  waterSpend: number;
};

export type ActivityMetric = "electricityKwh" | "averageKw" | "electricitySpend" | "waterKl" | "waterSpend";

export type TariffPoint = {
  periodDateTime: string;
  dateLabel: string;
  tariff: number;
  chargeLabel: string;
  spend: number;
  mixed?: boolean;
};

export type Insight = {
  title: string;
  body: string;
  tone?: "neutral" | "good" | "watch";
};

export type Analytics = {
  daily: DailyPoint[];
  hourly: HourlyPoint[];
  tariffTimeline: TariffPoint[];
  waterTariffTimeline: TariffPoint[];
  metrics: {
    totalSpend: number;
    totalEnergySpend: number;
    totalWaterSpend: number;
    totalFixedSpend: number;
    totalKwh: number;
    totalWaterKl: number;
    energyCostPerKwh: number;
    allInCostPerKwh: number;
    averageSpendPerDay: number;
    averageKwhPerDay: number;
    averageWaterKlPerDay: number;
    highestSpendDay?: DailyPoint;
    highestUsageDay?: DailyPoint;
    highestWaterDay?: DailyPoint;
    highestUsageHour?: UsageHourPeak;
    latestBalance?: number;
    latestPeriod?: string;
    dateStart?: string;
    dateEnd?: string;
    dayCount: number;
  };
  insights: Insight[];
};
