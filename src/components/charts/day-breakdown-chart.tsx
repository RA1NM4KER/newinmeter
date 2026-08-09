"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ActivityDialog } from "@/components/activities/activity-dialog";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { buildIntervalPoints, buildStableAxisDomains, sumRows } from "@/lib/day-breakdown";
import { fetchActivityReport } from "@/lib/activity-client";
import { activityOverlayRange, activityTimeLabel, displayActivityTag } from "@/lib/activity-utils";
import { buildDayIntervalsUrl } from "@/lib/endpoints";
import { formatCurrency, formatKl, formatKwh } from "@/lib/format";
import { queryHref } from "@/lib/url-query";
import type { UsageActivity } from "@/lib/types";
import { ExpandChartButton, ExpandProvider, FullscreenChart } from "./chart-shell";
import { chartColors, chartMargin, chartTooltipStyle } from "./chart-config";
import { DaySummaryCard } from "./day-summary-card";
import type { DayBreakdownChartProps } from "./types";

type IntervalApiResponse = {
  rows: Array<{
    periodDate: string;
    periodTime: string;
    spend: number;
    kwh: number;
    waterSpend: number;
    waterKl: number;
  }>;
};

async function fetchIntervals(periodDate: string) {
  const response = await fetch(buildDayIntervalsUrl(periodDate), {
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Failed to load day intervals.");
  }

  return (await response.json()) as IntervalApiResponse;
}

export function DayBreakdownChart({
  selectedDate,
  onSelectedDateChange,
  dateOptions,
  dailyRows,
  globalDomains,
  activitiesEnabled = false
}: DayBreakdownChartProps) {
  const [isCompactAxis, setIsCompactAxis] = useState(false);
  const [utility, setUtility] = useState<"electricity" | "water">("electricity");
  const [dialogActivity, setDialogActivity] = useState<UsageActivity | null | undefined>(undefined);
  const [activeActivityId, setActiveActivityId] = useState<string>();
  const searchParams = useSearchParams();
  const activitiesHref = queryHref("/activities", new URLSearchParams(searchParams.toString()));
  const selectableDates = useMemo(() => new Set(dateOptions), [dateOptions]);
  const { data } = useQuery({
    queryKey: ["day-intervals", selectedDate],
    queryFn: () => fetchIntervals(selectedDate),
    enabled: Boolean(selectedDate)
  });
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const { data: activityReport } = useQuery({
    queryKey: ["activity-report", { from: selectedDate, to: selectedDate }],
    queryFn: () => fetchActivityReport({ from: selectedDate, to: selectedDate }),
    enabled: activitiesEnabled && Boolean(selectedDate)
  });
  const dayActivities = activityReport?.rows ?? [];
  const activeActivity = dayActivities.find((activity) => activity.id === activeActivityId);
  const intervalData = buildIntervalPoints(rows, selectedDate);
  const perDayDomains = useMemo(() => buildStableAxisDomains(rows), [rows]);
  const axisDomains = globalDomains ?? perDayDomains;
  const energySpend = sumRows(rows, "spend");
  const usage = sumRows(rows, "kwh");
  const waterSpend = sumRows(rows, "waterSpend");
  const waterUsage = sumRows(rows, "waterKl");
  const fixedSpend = dailyRows.find((row) => row.periodDate === selectedDate)?.fixedSpend ?? 0;
  const utilityConfig =
    utility === "water"
      ? {
          spendKey: "waterSpend" as const,
          usageKey: "waterKl" as const,
          usageAxisId: "water" as const,
          spendDomain: axisDomains.waterSpend,
          usageDomain: axisDomains.waterKl,
          usageTickFormatter: (value: number) => `${value}`,
          usageFormatter: formatKl,
          usageLabel: "Water usage",
          spendLabel: "Water spend"
        }
      : {
          spendKey: "spend" as const,
          usageKey: "kwh" as const,
          usageAxisId: "kwh" as const,
          spendDomain: axisDomains.spend,
          usageDomain: axisDomains.kwh,
          usageTickFormatter: (value: number) => `${value}`,
          usageFormatter: formatKwh,
          usageLabel: "Energy usage",
          spendLabel: "Energy spend"
        };

  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setIsCompactAxis(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  // Hover is driven by the chart's own mouse-tracking (activeLabel is the
  // nearest x-axis time under the cursor, computed from raw coordinates)
  // rather than per-ReferenceArea mouseenter/leave. Bar segments and the
  // range label are separate DOM elements stacked above the ReferenceArea's
  // rect, so hit-testing per-element flickered on/off as the cursor crossed
  // those internal boundaries even while staying inside one activity's span.
  const findActivityAtTime = (time?: string | number) => {
    if (time === undefined) return undefined;
    const label = String(time);
    return dayActivities.find((activity) => {
      const range = activityOverlayRange(activity, selectedDate);
      return range && range.startTime <= label && label <= range.endTime;
    });
  };

  const renderChart = (axisInterval: number) => (
    <div className="relative h-full">
      <ResponsiveContainer height="100%" width="100%">
        <ComposedChart
          data={intervalData}
          margin={chartMargin}
          onMouseMove={(state) => setActiveActivityId(findActivityAtTime(state.activeLabel)?.id)}
          onMouseLeave={() => setActiveActivityId(undefined)}
        >
          <CartesianGrid stroke={chartColors.line} vertical={false} />
          <XAxis
            dataKey="time"
            interval={axisInterval}
            minTickGap={16}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            yAxisId="spend"
            domain={[0, utilityConfig.spendDomain]}
            tickFormatter={(value) => `R${value}`}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <YAxis
            yAxisId={utilityConfig.usageAxisId}
            domain={[0, utilityConfig.usageDomain]}
            orientation="right"
            tickFormatter={utilityConfig.usageTickFormatter}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <Tooltip
            contentStyle={chartTooltipStyle}
            formatter={(value, name) => [
              name === utilityConfig.spendKey
                ? formatCurrency(Number(value))
                : utilityConfig.usageFormatter(Number(value)),
              name === utilityConfig.spendKey ? utilityConfig.spendLabel : utilityConfig.usageLabel
            ]}
          />
          {dayActivities.map((activity, index) => {
            const range = activityOverlayRange(activity, selectedDate);
            return range ? (
              <ReferenceArea
                fill={chartColors.projection}
                fillOpacity={activity.allDay ? 0.055 : 0.1}
                key={activity.id}
                label={
                  index < 3
                    ? {
                        value: displayActivityTag(activity.tags[0]),
                        position: "insideTop",
                        offset: 7 + index * 13,
                        fill: chartColors.average,
                        fontSize: 10,
                        // Without this, the label text sits on top of the
                        // rect and steals mouse events -- crossing it while
                        // still inside the same activity's range fires a
                        // spurious leave (then nothing, since the label has
                        // no handlers of its own), flickering the popup.
                        className: "pointer-events-none"
                      }
                    : undefined
                }
                onClick={() => setActiveActivityId(activity.id)}
                stroke={chartColors.projection}
                strokeOpacity={0.35}
                x1={range.startTime}
                x2={range.endTime}
                // A whole-day range's x2 lands exactly on the chart's final
                // category tick. Recharts' ReferenceArea computes that
                // point via scale(value) + bandwidth(), which lands a hair
                // outside the scaleBand's floating-point range on this axis
                // -- its default ifOverflow="discard" then silently drops
                // the whole area (0 DOM nodes, no error). extendDomain
                // skips that in-range check; every other range here is
                // already within bounds, so this only changes behavior for
                // the previously-broken whole-day case. Reproduced by
                // shrinking x2 by one tick (renders) vs. leaving it exact
                // (doesn't) before landing on this fix.
                ifOverflow="extendDomain"
                yAxisId="spend"
              />
            ) : null;
          })}
          <Bar
            yAxisId={utilityConfig.usageAxisId}
            dataKey={utilityConfig.usageKey}
            fill={chartColors.usage}
            radius={[4, 4, 0, 0]}
          />
          <Line
            yAxisId="spend"
            dataKey={utilityConfig.spendKey}
            type="monotone"
            stroke={chartColors.spend}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {activeActivity ? (
        <div className="absolute left-2 top-2 z-[2] max-w-[min(16rem,calc(100%-1rem))] rounded-md border border-line bg-paper/95 p-2 text-[0.7rem] shadow-soft sm:left-3 sm:top-3 sm:max-w-[min(18rem,calc(100%-1.5rem))] sm:p-3 sm:text-xs">
          <p className="font-medium text-ink">{activityTimeLabel(activeActivity)}</p>
          <p className="mt-0.5 text-muted sm:mt-1">{activeActivity.tags.map(displayActivityTag).join(", ")}</p>
          {activeActivity.note ? (
            <p className="mt-0.5 hidden text-muted sm:mt-1 sm:block">{activeActivity.note}</p>
          ) : null}
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted sm:mt-2 sm:gap-y-1">
            <span>Electricity</span>
            <span className="text-right">{formatKwh(activeActivity.electricityKwh)}</span>
            <span>Electricity spend</span>
            <span className="text-right">{formatCurrency(activeActivity.electricitySpend)}</span>
            <span>Water</span>
            <span className="text-right">{formatKl(activeActivity.waterKl)}</span>
            <span>Water spend</span>
            <span className="text-right">{formatCurrency(activeActivity.waterSpend)}</span>
          </div>
        </div>
      ) : null}
    </div>
  );

  const utilityControl = (
    <DropdownSelect
      ariaLabel="Day detail utility"
      value={utility}
      options={[
        { label: "Electricity", value: "electricity" },
        { label: "Water", value: "water" }
      ]}
      onChange={(value) => setUtility(value as "electricity" | "water")}
      className="w-full sm:w-32"
    />
  );

  const addButton = (
    <button
      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line bg-paper px-3 text-sm font-medium text-ink transition hover:bg-canvas sm:w-auto"
      onClick={() => setDialogActivity(null)}
      type="button"
    >
      <Plus className="h-4 w-4 text-accent" /> Add activity
    </button>
  );

  const dateControl = (
    <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto">
      {utilityControl}
      <DatePicker
        closeOnSelect={false}
        label="Day detail date"
        max={dateOptions[dateOptions.length - 1]}
        min={dateOptions[0]}
        onChange={onSelectedDateChange}
        selectableDates={selectableDates}
        value={selectedDate}
        fullWidth
      />
    </div>
  );

  return (
    <ExpandProvider>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3.5 sm:px-5">
          <h2 className="text-base font-semibold text-ink">Day detail</h2>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            {dateControl}
            {activitiesEnabled ? addButton : null}
            <ExpandChartButton />
          </div>
        </div>
        <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[1fr_22rem]">
          <div className="h-72 sm:h-80">{renderChart(isCompactAxis ? 7 : 3)}</div>
          <aside className="space-y-4">
            <div className="grid content-start grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-2">
              <DaySummaryCard label="Energy spend" value={formatCurrency(energySpend)} />
              <DaySummaryCard label="Energy usage" value={formatKwh(usage)} />
              <DaySummaryCard label="Water spend" value={formatCurrency(waterSpend)} />
              <DaySummaryCard label="Water usage" value={formatKl(waterUsage)} />
              <DaySummaryCard label="Fixed charges" value={formatCurrency(fixedSpend)} />
              {activitiesEnabled ? (
                <DaySummaryCard
                  detail={dayActivities.length ? "See what was happening" : "Add context for this day"}
                  href={dayActivities.length ? activitiesHref : undefined}
                  label="Activities"
                  onClick={dayActivities.length ? undefined : () => setDialogActivity(null)}
                  value={String(dayActivities.length)}
                />
              ) : null}
            </div>
          </aside>
        </div>
      </Card>
      <FullscreenChart
        title="Day detail"
        action={
          <>
            {dateControl}
            {activitiesEnabled ? addButton : null}
          </>
        }
      >
        {renderChart(3)}
      </FullscreenChart>
      {activitiesEnabled ? (
        <ActivityDialog
          activity={dialogActivity ?? undefined}
          defaultDate={selectedDate}
          isOpen={dialogActivity !== undefined}
          onClose={() => setDialogActivity(undefined)}
        />
      ) : null}
    </ExpandProvider>
  );
}
