import type { DailyRollupRow, DashboardSummary, HourlyRollupRow, Insight, QuickRange } from "@/lib/types";
import type { QuickRangePreset } from "@/lib/filters";
import type { ReactNode } from "react";
import type { FeatureAdoption, FeatureRates, PromptRule } from "@/lib/dashboard-prompts";

export type DashboardShellProps = {
  dailyRows: DailyRollupRow[];
  hourlyRows: HourlyRollupRow[];
  summary: DashboardSummary;
  alertRules?: PromptRule[];
  featureAdoption?: FeatureAdoption | null;
  featureRates?: FeatureRates;
  promptDay?: string;
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
