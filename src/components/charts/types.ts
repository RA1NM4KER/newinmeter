import type { DayBreakdownDomains } from "@/lib/day-breakdown";
import type { ReactNode } from "react";
import type { DailyPoint, DailyRollupRow, HourlyPoint, TariffPoint, UsageActivity } from "@/lib/types";

export type ChartShellProps = {
  title: string;
  titleAdornment?: ReactNode;
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
  // Dialog-only mode: skip the permanent inline "Day detail" card and open
  // straight into the fullscreen chart. Used when this component is mounted
  // on demand (e.g. activities' "Jump to day detail") rather than living
  // permanently on the page like the main dashboard's copy does.
  hideInlineCard?: boolean;
  autoExpand?: boolean;
  onCloseDialog?: () => void;
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
