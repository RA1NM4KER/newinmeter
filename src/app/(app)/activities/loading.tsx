"use client";

import { ChevronDown, FileDown, Info, Maximize2 } from "lucide-react";
import { activityMetricOptions } from "@/components/activities/activity-report-chart";
import { TaggedUsageChartSkeleton } from "@/components/activities/tagged-usage-chart-skeleton";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Card } from "@/components/ui/card";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useFilterUrlState } from "@/lib/use-filter-url-state";

export default function ActivitiesLoading() {
  const { from, to, quickRange, isPending, onDateChange, onQuickRange } = useFilterUrlState({});

  return (
    <div className="flex flex-1 flex-col gap-5 py-6">
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

      <div>
        <h1 className="text-xl font-semibold text-ink">Activities</h1>
        <p className="mt-1 text-sm text-muted">Compare household usage during the periods you tagged.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="rounded-lg border border-line bg-paper p-4" key={index}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-32 max-w-full" />
          </div>
        ))}
      </div>

      <div className="flex gap-2 rounded-md border border-line bg-paper px-3 py-3 text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          Tags provide context for household usage during a period. NewinMeter cannot identify the exact consumption of
          an individual appliance without device-level monitoring.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
          <h2 className="text-base font-semibold text-ink">Tagged usage</h2>
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
          <TaggedUsageChartSkeleton />
        </div>
      </Card>
    </div>
  );
}
