import type { DailyRollupRow, DashboardSummary, HourlyRollupRow } from "./types";
import type { FeatureAdoption, FeatureRates, PromptRule } from "./dashboard-prompts";

export type DashboardSectionData = {
  summary: DashboardSummary;
  daily: DailyRollupRow[];
  hourly: HourlyRollupRow[];
  prompts: {
    alertRules: PromptRule[];
    featureAdoption: FeatureAdoption | null;
    featureRates: FeatureRates;
    promptDay: string;
  };
};
export type DashboardSection = keyof DashboardSectionData;
export const DASHBOARD_SECTIONS: DashboardSection[] = ["summary", "daily", "hourly", "prompts"];
