import type { ActivityReportRow } from "@/lib/types";

export type ActivityReportColumnId =
  | "date"
  | "time"
  | "tags"
  | "duration"
  | "electricityUsage"
  | "averageDemand"
  | "electricitySpend"
  | "waterUsage"
  | "waterSpend"
  | "note"
  | "actions";

export type ActivityReportColumn = {
  id: ActivityReportColumnId;
  label: string;
  shortLabel?: string;
  cellClassName: string;
  sortable: boolean;
  skeletonClassName: string;
};

export const activityReportColumns: ActivityReportColumn[] = [
  {
    id: "date",
    label: "Date",
    cellClassName: "whitespace-nowrap font-medium text-ink",
    sortable: true,
    skeletonClassName: "h-4 w-14"
  },
  {
    id: "time",
    label: "Time",
    cellClassName: "whitespace-nowrap text-muted",
    sortable: false,
    skeletonClassName: "h-4 w-24"
  },
  { id: "tags", label: "Tags", cellClassName: "", sortable: false, skeletonClassName: "h-5 w-20 rounded-full" },
  {
    id: "duration",
    label: "Duration",
    cellClassName: "whitespace-nowrap text-muted",
    sortable: true,
    skeletonClassName: "h-4 w-12"
  },
  {
    id: "electricityUsage",
    label: "Electricity usage",
    shortLabel: "Elec. usage",
    cellClassName: "whitespace-nowrap",
    sortable: true,
    skeletonClassName: "h-4 w-14"
  },
  {
    id: "averageDemand",
    label: "Average demand",
    shortLabel: "Avg demand",
    cellClassName: "whitespace-nowrap",
    sortable: true,
    skeletonClassName: "h-4 w-14"
  },
  {
    id: "electricitySpend",
    label: "Electricity spend",
    shortLabel: "Elec. spend",
    cellClassName: "whitespace-nowrap",
    sortable: true,
    skeletonClassName: "h-4 w-14"
  },
  {
    id: "waterUsage",
    label: "Water usage",
    cellClassName: "whitespace-nowrap",
    sortable: true,
    skeletonClassName: "h-4 w-12"
  },
  {
    id: "waterSpend",
    label: "Water spend",
    cellClassName: "whitespace-nowrap",
    sortable: true,
    skeletonClassName: "h-4 w-12"
  },
  { id: "note", label: "Note", cellClassName: "max-w-60 text-muted", sortable: false, skeletonClassName: "h-4 w-8" },
  { id: "actions", label: "Actions", cellClassName: "", sortable: false, skeletonClassName: "h-4 w-4" }
];

export type ActivityReportSortKey = Extract<
  ActivityReportColumnId,
  "date" | "duration" | "electricityUsage" | "averageDemand" | "electricitySpend" | "waterUsage" | "waterSpend"
>;

export const ACTIVITY_REPORT_DEFAULT_SORT: ActivityReportSortKey = "date";
export const ACTIVITY_REPORT_DEFAULT_DIRECTION: "asc" | "desc" = "desc";

const sortValue: Record<ActivityReportSortKey, (row: ActivityReportRow) => number> = {
  // Full timestamp, not just the day, so multiple activities on the same
  // date still land in a sensible (chronological) order relative to each
  // other instead of whatever order the API happened to return them in.
  date: (row) => Date.parse(row.startsAt),
  duration: (row) => row.durationMinutes,
  electricityUsage: (row) => row.electricityKwh,
  averageDemand: (row) => row.averageKw,
  electricitySpend: (row) => row.electricitySpend,
  waterUsage: (row) => row.waterKl,
  waterSpend: (row) => row.waterSpend
};

export function sortActivityReportRows(
  rows: ActivityReportRow[],
  sortKey: ActivityReportSortKey,
  direction: "asc" | "desc"
): ActivityReportRow[] {
  const getValue = sortValue[sortKey];
  const dir = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => (getValue(a) - getValue(b)) * dir);
}
