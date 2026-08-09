import type { DayBreakdownDomains } from "@/lib/day-breakdown";
import type { ReactNode } from "react";
import type { DailyPoint, DailyRollupRow, HourlyPoint, TariffPoint, UsageActivity } from "@/lib/types";

export type ChartShellProps = {
  title: string;
  action?: ReactNode;
  footer?: ReactNode;
  fullScreenChildren?: ReactNode;
  children: ReactNode;
};

export type DailyChartProps = {
  data: DailyPoint[];
  activities?: UsageActivity[];
  onSelectDate?: (date: string) => void;
};

export type HourlyChartProps = {
  data: HourlyPoint[];
  metric: "spend" | "kwh";
  title: string;
};

export type TariffChartProps = {
  electricity: TariffPoint[];
  water: TariffPoint[];
};

export type DayBreakdownChartProps = {
  selectedDate: string;
  onSelectedDateChange(date: string): void;
  dateOptions: string[];
  dailyRows: DailyRollupRow[];
  globalDomains?: DayBreakdownDomains;
  activitiesEnabled?: boolean;
};

export type ProjectedBarShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type DaySummaryCardProps = {
  label: string;
  value: string;
  href?: string;
  detail?: string;
  onClick?: () => void;
};
