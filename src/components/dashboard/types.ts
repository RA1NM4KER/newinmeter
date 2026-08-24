import type { DailyRollupRow, DashboardSummary, HourlyRollupRow, Insight, QuickRange } from "@/lib/types";
import type { QuickRangePreset } from "@/lib/filters";
import type { ReactNode } from "react";

export type DashboardShellProps = {
  dailyRows: DailyRollupRow[];
  hourlyRows: HourlyRollupRow[];
  summary: DashboardSummary;
  isAiAssistantEnabled?: boolean;
  isActivitiesEnabled?: boolean;
  isAlertsEnabled?: boolean;
  isDemo?: boolean;
};

export type InsightsProps = {
  insights: Insight[];
};

export type IsoDateInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

export type FilterBarProps = {
  from: string;
  to: string;
  quickRange: QuickRange;
  onDateChange: (from: string, to: string) => void;
  onQuickRange: (range: QuickRangePreset) => void;
  loading?: boolean;
  leftControls?: ReactNode;
  extraControls?: ReactNode;
  rightControls?: ReactNode;
  rightControlsExpanded?: boolean;
  splitMobileRow?: boolean;
  fullBleed?: boolean;
  sticky?: boolean;
};
