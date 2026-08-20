"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { DataSyncAction } from "@/components/data/data-sync-action";
import { CumulativeSpendChart } from "@/components/charts/cumulative-spend-chart";
import { DayBreakdownChart } from "@/components/charts/day-breakdown-chart";
import { DailyKwhChart } from "@/components/charts/daily-kwh-chart";
import { DailySpendChart } from "@/components/charts/daily-spend-chart";
import { HourlyChart } from "@/components/charts/hourly-chart";
import { TariffChart } from "@/components/charts/tariff-chart";
import { MetricCard } from "@/components/ui/metric-card";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { createAnalytics } from "@/lib/analytics";
import { fetchActivities } from "@/lib/activity-client";
import { buildGlobalDomainsFromSummary } from "@/lib/day-breakdown";
import { previousComparableScope } from "@/lib/period-comparison";
import { useFilterUrlState } from "@/lib/use-filter-url-state";
import { FilterBar } from "./filter-bar";
import { Insights } from "./insights";
import { buildMetricCards } from "./metric-cards";
import type { DashboardShellProps } from "./types";

export function DashboardShell({
  dailyRows,
  hourlyRows,
  summary,
  isAiAssistantEnabled = true,
  isActivitiesEnabled = false
}: DashboardShellProps) {
  const { from, to, quickRange, isPending, onDateChange, onQuickRange } = useFilterUrlState({
    from: summary.dateStart,
    to: summary.dateEnd
  });
  const analytics = useMemo(
    () =>
      createAnalytics(dailyRows, hourlyRows, from, to, {
        latestBalance: summary.latestBalance,
        latestPeriod: summary.latestPeriod
      }),
    [dailyRows, hourlyRows, from, summary.latestBalance, summary.latestPeriod, to]
  );
  const previousScope = useMemo(() => {
    if (!from || !to) {
      return undefined;
    }

    return previousComparableScope({ from, to });
  }, [from, to]);
  const previousAnalytics = useMemo(() => {
    if (!previousScope) {
      return undefined;
    }

    return createAnalytics(dailyRows, hourlyRows, previousScope.from, previousScope.to);
  }, [dailyRows, hourlyRows, previousScope]);
  const dateOptions = useMemo(
    () => Array.from(new Set(dailyRows.map((row) => row.periodDate))).sort((left, right) => left.localeCompare(right)),
    [dailyRows]
  );
  const globalDomains = buildGlobalDomainsFromSummary(summary);
  const initialDay = summary.dateEnd ?? dateOptions[dateOptions.length - 1] ?? "";
  const [selectedDate, setSelectedDate] = useState(initialDay);
  const dayDetailRef = useRef<HTMLDivElement>(null);
  const { data: activitiesData } = useQuery({
    queryKey: ["activities", { from, to }],
    queryFn: () => fetchActivities({ from, to }),
    enabled: isActivitiesEnabled && Boolean(from && to)
  });
  const activities = activitiesData?.activities ?? [];

  // Keep the selected detail date valid when a URL range change replaces
  // the available rollup dates.
  const effectiveSelectedDate = dateOptions.includes(selectedDate) ? selectedDate : initialDay;

  function selectDay(date: string) {
    setSelectedDate(date);
    requestAnimationFrame(() => dayDetailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const metrics = analytics.metrics;
  const metricCards = buildMetricCards(metrics, previousAnalytics?.metrics);
  const metricsRailRef = useRef<HTMLElement>(null);
  const spendKwhRailRef = useRef<HTMLElement>(null);
  const tariffCumulativeRailRef = useRef<HTMLElement>(null);
  const hourlyRailRef = useRef<HTMLElement>(null);

  return (
    <div className="flex flex-1 flex-col gap-5 py-6">
      <FilterBar
        from={from}
        to={to}
        quickRange={quickRange}
        onDateChange={onDateChange}
        onQuickRange={onQuickRange}
        loading={isPending}
        leftControls={<DataSyncAction lastSyncedAt={summary.lastSyncedAt} />}
        rightControls={isAiAssistantEnabled ? <AssistantPanel from={from} to={to} compact /> : undefined}
        rightControlsExpanded
        fullBleed
        sticky
      />

      <div className="relative">
        <section
          ref={metricsRailRef}
          className="snap-rail touch-pan-x touch-pan-y flex snap-x gap-4 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 lg:grid-cols-4 xl:grid-cols-5 [&>section]:min-w-max [&>section]:snap-start sm:[&>section]:min-w-0"
        >
          {metricCards.map((card) => (
            <MetricCard
              key={card.label}
              label={card.label}
              value={card.value}
              detail={card.detail}
              description={card.description}
              tone={card.tone}
              comparison={card.comparison}
            />
          ))}
        </section>
        <ScrollHint containerRef={metricsRailRef} />
      </div>

      <div className="relative">
        <section
          ref={spendKwhRailRef}
          className="snap-rail touch-pan-x touch-pan-y -mx-3 flex snap-x gap-5 overflow-x-auto px-3 pb-1 lg:mx-0 lg:grid lg:grid-cols-2 lg:px-0 lg:pb-0 [&>section]:min-w-[88vw] [&>section]:snap-center sm:[&>section]:min-w-[24rem] lg:[&>section]:min-w-0"
        >
          <DailySpendChart data={analytics.daily} />
          <DailyKwhChart data={analytics.daily} activities={activities} onSelectDate={selectDay} />
        </section>
        <ScrollHint containerRef={spendKwhRailRef} />
      </div>

      <div ref={dayDetailRef} className="scroll-mt-4">
        <DayBreakdownChart
          activitiesEnabled={isActivitiesEnabled}
          dailyRows={dailyRows}
          dateOptions={dateOptions}
          globalDomains={globalDomains}
          selectedDate={effectiveSelectedDate}
          onSelectedDateChange={setSelectedDate}
        />
      </div>

      <div className="relative">
        <section
          ref={tariffCumulativeRailRef}
          className="snap-rail touch-pan-x touch-pan-y -mx-3 flex snap-x gap-5 overflow-x-auto px-3 pb-1 lg:mx-0 lg:grid lg:grid-cols-2 lg:px-0 lg:pb-0 [&>section]:min-w-[88vw] [&>section]:snap-center sm:[&>section]:min-w-[24rem] lg:[&>section]:min-w-0"
        >
          <TariffChart electricity={analytics.tariffTimeline} water={analytics.waterTariffTimeline} />
          <CumulativeSpendChart data={analytics.daily} />
        </section>
        <ScrollHint containerRef={tariffCumulativeRailRef} />
      </div>

      <div className="relative">
        <section
          ref={hourlyRailRef}
          className="snap-rail touch-pan-x touch-pan-y -mx-3 flex snap-x gap-5 overflow-x-auto px-3 pb-1 lg:mx-0 lg:grid lg:grid-cols-2 lg:px-0 lg:pb-0 [&>section]:min-w-[88vw] [&>section]:snap-center sm:[&>section]:min-w-[24rem] lg:[&>section]:min-w-0"
        >
          <HourlyChart data={analytics.hourly} metric="spend" title="Total energy spend by hour" />
          <HourlyChart data={analytics.hourly} metric="kwh" title="Total energy usage by hour" />
        </section>
        <ScrollHint containerRef={hourlyRailRef} />
      </div>

      <Insights insights={analytics.insights} />
    </div>
  );
}
