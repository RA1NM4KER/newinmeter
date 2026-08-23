"use client";

import { ChevronDown, FileDown, Info, Maximize2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { activityMetricOptions } from "@/components/activities/activity-report-chart";
import { activityReportColumns } from "@/components/activities/activity-report-columns";
import { ActivityReportSkeletonRows } from "@/components/activities/activity-report-skeleton-rows";
import { ACTIVITY_TAGS_DISCLAIMER, activityTabs } from "@/components/activities/activity-tabs";
import { BarChartSkeleton } from "@/components/charts/bar-chart-skeleton";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Card } from "@/components/ui/card";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { MetricCardSkeleton } from "@/components/ui/metric-card";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { useFilterUrlState } from "@/lib/url-state/use-filter-url-state";

export default function ActivitiesLoading() {
  const { from, to, quickRange, isPending, onDateChange, onQuickRange } = useFilterUrlState({});
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") === "table" ? "table" : "dashboard";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 pt-6">
      <FilterBar
        from={from}
        to={to}
        quickRange={quickRange}
        onDateChange={onDateChange}
        onQuickRange={onQuickRange}
        loading={isPending}
        leftControls={
          <button
            className="inline-flex h-9 items-center rounded-md bg-white px-3 text-sm font-medium text-brandTeal opacity-70"
            disabled
            type="button"
          >
            + Add activity
          </button>
        }
        extraControls={
          <DropdownSelect
            ariaLabel="Activity tags"
            className="w-28"
            loading
            onChange={() => undefined}
            options={[{ label: "All tags", value: "all" }]}
            tone="dark"
            value="all"
          />
        }
        rightControls={
          <button
            className="inline-flex h-9 items-center justify-between gap-2 rounded-md border border-white/15 bg-white/10 px-3 text-sm text-white opacity-70"
            disabled
            type="button"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <FileDown aria-hidden="true" className="h-4 w-4 shrink-0 text-white/70" />
              <span className="shrink-0">Export</span>
            </span>
            <ChevronDown aria-hidden="true" className="h-4 w-4 text-white/70" />
          </button>
        }
        splitMobileRow
        fullBleed
      />

      <div className="hidden sm:block">
        <h1 className="text-xl font-semibold text-ink">Activities</h1>
        <p className="mt-1 text-sm text-muted">Compare household usage during the periods you tagged.</p>
      </div>

      <UnderlineTabs
        tabs={activityTabs}
        activeId={activeTab}
        onChange={() => undefined}
        endSlot={
          <span className="pb-2 sm:hidden">
            <InfoTooltip label="About activity tags" text={ACTIVITY_TAGS_DISCLAIMER} />
          </span>
        }
      />

      {activeTab === "dashboard" ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <MetricCardSkeleton key={index} />
            ))}
          </div>

          <div className="hidden gap-2 rounded-md border border-line bg-paper px-3 py-3 text-sm text-muted sm:flex">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p>{ACTIVITY_TAGS_DISCLAIMER}</p>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
              <h2 className="text-base font-semibold text-ink">
                <span className="sm:hidden">Tagged</span>
                <span className="hidden sm:inline">Tagged usage</span>
              </h2>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <DropdownSelect
                  ariaLabel="Activity metric"
                  className="w-48"
                  loading
                  onChange={() => undefined}
                  options={activityMetricOptions}
                  value="electricityKwh"
                />
                <button
                  aria-label="Maximize chart"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-paper text-ink opacity-70"
                  disabled
                  type="button"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="h-64 px-1 py-4 sm:h-72 sm:px-4">
              <BarChartSkeleton label="tagged usage chart" />
            </div>
          </Card>
        </>
      ) : (
        <section className="-mx-3 flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line bg-paper sm:-mx-6 lg:mx-0 lg:rounded-lg lg:border">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-line bg-accentSoft text-xs uppercase tracking-[0.12em] text-brandTeal dark:text-accent">
                <tr>
                  {activityReportColumns.map((column) => (
                    <th className="px-3 py-3 font-medium" key={column.id}>
                      {column.shortLabel ? (
                        <>
                          <span className="sm:hidden">{column.shortLabel}</span>
                          <span className="hidden sm:inline">{column.label}</span>
                        </>
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <ActivityReportSkeletonRows rowCount={8} />
              </tbody>
            </table>
          </div>

          <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line px-3">
            <p className="text-sm text-muted">Loading activities...</p>
          </div>
        </section>
      )}
    </div>
  );
}
