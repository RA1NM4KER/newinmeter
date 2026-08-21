"use client";

import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { DataSyncAction } from "@/components/data/data-sync-action";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { useFilterUrlState } from "@/lib/url-state/use-filter-url-state";
import { useRef } from "react";

export default function DashboardLoading() {
  const { from, to, quickRange, isPending, onDateChange, onQuickRange } = useFilterUrlState({});
  const metricsRailRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-1 flex-col gap-5 py-6">
      <FilterBar
        from={from}
        to={to}
        quickRange={quickRange}
        onDateChange={onDateChange}
        onQuickRange={onQuickRange}
        loading={isPending}
        leftControls={<DataSyncAction loading />}
        rightControls={<AssistantPanel from={from} to={to} compact />}
        rightControlsExpanded
        fullBleed
        sticky
      />

      <div className="relative">
        <section
          ref={metricsRailRef}
          className="snap-rail touch-pan-x touch-pan-y flex snap-x gap-4 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:grid-cols-4 xl:grid-cols-5 [&>section]:min-w-max [&>section]:snap-start sm:[&>section]:min-w-0"
        >
          {Array.from({ length: 10 }, (_, index) => (
            <section key={index} className="rounded-lg border border-line bg-paper p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-3 h-6 w-20" />
            </section>
          ))}
        </section>
        <ScrollHint containerRef={metricsRailRef} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-64 rounded-lg border border-line bg-paper p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-5 h-40 w-full" />
        </div>
        <div className="h-64 rounded-lg border border-line bg-paper p-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-5 h-40 w-full" />
        </div>
      </div>

      <div className="h-80 rounded-lg border border-line bg-paper p-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-5 h-56 w-full" />
      </div>
    </div>
  );
}
