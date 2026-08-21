import { Info } from "lucide-react";
import { ActivityReportChart, activityMetricOptions } from "./activity-report-chart";
import { ACTIVITY_TAGS_DISCLAIMER } from "./activity-tabs";
import { BarChartSkeleton } from "@/components/charts/bar-chart-skeleton";
import { ChartShell } from "@/components/charts/chart-shell";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { MetricCard, MetricCardSkeleton } from "@/components/ui/metric-card";
import { formatActivityDuration } from "@/lib/activity/utils";
import { formatKwh } from "@/lib/format";
import type { ActivityMetric } from "@/lib/types";
import type { ActivityDashboardTabProps } from "./types";

export function ActivityDashboardTab({
  summary,
  rows,
  isLoading,
  hasNoActivitiesEver,
  metric,
  onMetricChange,
  onAddActivity,
  onEditActivity,
  onJumpToDay
}: ActivityDashboardTabProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard label="Activities" value={String(summary?.activityCount ?? 0)} detail="Filtered occurrences" />
            <MetricCard
              label="Tagged duration"
              value={formatActivityDuration(summary?.taggedDurationMinutes ?? 0)}
              detail="Overlaps counted once"
            />
            <MetricCard
              label={
                <>
                  <span className="sm:hidden">Electricity</span>
                  <span className="hidden sm:inline">Household electricity</span>
                </>
              }
              value={formatKwh(summary?.electricityKwh ?? 0)}
              detail="Overlapping intervals counted once"
            />
            <MetricCard
              label="Average per activity"
              value={formatKwh(summary?.averageElectricityKwhPerActivity ?? 0)}
              detail="Average household usage per occurrence"
            />
          </>
        )}
      </div>

      <div className="hidden gap-2 rounded-md border border-line bg-paper px-3 py-3 text-sm text-muted sm:flex">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>{ACTIVITY_TAGS_DISCLAIMER}</p>
      </div>

      <ChartShell
        title={
          <>
            <span className="sm:hidden">Tagged</span>
            <span className="hidden sm:inline">Tagged usage</span>
          </>
        }
        action={
          <DropdownSelect
            ariaLabel="Activity metric"
            className="w-48"
            value={metric}
            options={activityMetricOptions}
            onChange={(value) => onMetricChange(value as ActivityMetric)}
          />
        }
      >
        {isLoading ? (
          <BarChartSkeleton label="tagged usage chart" />
        ) : rows.length ? (
          <ActivityReportChart rows={rows} metric={metric} onEdit={onEditActivity} onJumpToDay={onJumpToDay} />
        ) : hasNoActivitiesEver ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div>
              <p className="text-sm font-medium text-ink">Nothing tagged yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                Tag a day or time range with what was happening, then compare your household usage during those periods.
              </p>
            </div>
            <button
              className="inline-flex h-9 items-center rounded-md bg-brandTeal px-3 text-sm font-medium text-white transition hover:brightness-110"
              onClick={onAddActivity}
              type="button"
            >
              Add your first activity
            </button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            No activities match these filters.
          </div>
        )}
      </ChartShell>
    </>
  );
}
