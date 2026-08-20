import type { ActivityMetric, ActivityReportRow, ActivityReportSummary } from "@/lib/types";
import type { ActivityReportSortKey } from "./activity-report-columns";

export type ActivityDashboardTabProps = {
  summary: ActivityReportSummary | undefined;
  rows: ActivityReportRow[];
  isLoading: boolean;
  hasNoActivitiesEver: boolean;
  metric: ActivityMetric;
  onMetricChange: (metric: ActivityMetric) => void;
  onAddActivity: () => void;
  onEditActivity: (activity: ActivityReportRow) => void;
  onJumpToDay: (activity: ActivityReportRow) => void;
};

export type ActivityReportTableProps = {
  rows: ActivityReportRow[];
  error: Error | null;
  isLoading: boolean;
  hasNoActivitiesEver: boolean;
  onEdit: (activity: ActivityReportRow) => void;
  sortKey: ActivityReportSortKey;
  sortDirection: "asc" | "desc";
  onSortChange: (key: ActivityReportSortKey) => void;
};
