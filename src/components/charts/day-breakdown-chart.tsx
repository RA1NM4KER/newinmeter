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
import { assignIntervalLanes, buildIntervalPoints, buildStableAxisDomains, sumRows } from "@/lib/day-breakdown";
import { fetchActivityReport } from "@/lib/activity-client";
import {
  DEFAULT_ACTIVITY_COLOR,
  activityIncludesInterval,
  activityOverlayRange,
  activityTimeLabel,
  addDaysToIsoDate,
  displayActivityTag
} from "@/lib/activity-utils";
import { buildDayIntervalsUrl } from "@/lib/endpoints";
import { formatCurrency, formatCurrencyAxisTick, formatKl, formatKwh } from "@/lib/format";
import { queryHref } from "@/lib/url-query";
import type { ActivityReportRow, UsageActivity } from "@/lib/types";
import { ActivityHoverCard, type ActivityCardAnchor } from "./activity-hover-card";
import { BarChartSkeleton } from "./bar-chart-skeleton";
import { ExpandChartButton, ExpandProvider, FullscreenChart } from "./chart-shell";
import { chartColors, chartMargin } from "./chart-config";
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

type DayDetailCardAnchor = ActivityCardAnchor & { surface: "inline" | "fullscreen" };

const formatUsageAxisTick = (value: number, unit: "kWh" | "kL") => `${value} ${unit}`;

function StaggeredActivityBorder({
  height = 0,
  lane,
  stroke,
  strokeWidth = 1.5,
  width = 0,
  x = 0,
  y = 0
}: {
  height?: number;
  lane: number;
  stroke?: string;
  strokeWidth?: number;
  width?: number;
  x?: number;
  y?: number;
}) {
  const top = y + lane * 4;
  const bottom = y + height;

  return (
    <path
      d={`M ${x} ${bottom} V ${top} H ${x + width} V ${bottom} H ${x}`}
      fill="none"
      pointerEvents="none"
      stroke={stroke}
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function ActivityNumberLabel({
  color,
  index,
  viewBox
}: {
  color: string;
  index: number;
  viewBox?: { height?: number; width?: number; x?: number; y?: number };
}) {
  const { width, x, y } = viewBox ?? {};
  if (typeof width !== "number" || typeof x !== "number" || typeof y !== "number") return null;
  const centerX = x + width / 2;
  const centerY = y + 12 + index * 11;

  return (
    <g pointerEvents="none">
      <circle cx={centerX} cy={centerY} fill={color} fillOpacity={0.14} r={5.5} />
      <text
        dominantBaseline="central"
        fill={color}
        fontSize={9}
        fontWeight={600}
        textAnchor="middle"
        x={centerX}
        y={centerY}
      >
        {index + 1}
      </text>
    </g>
  );
}

function ActivityTextLabel({
  color,
  index,
  label,
  viewBox
}: {
  color: string;
  index: number;
  label: string;
  viewBox?: { height?: number; width?: number; x?: number; y?: number };
}) {
  const { width, x, y } = viewBox ?? {};
  if (typeof width !== "number" || typeof x !== "number" || typeof y !== "number") return null;
  const centerX = x + width / 2;
  const centerY = y + 12 + index * 18;
  const pillWidth = Math.max(42, label.length * 6 + 14);

  return (
    <g pointerEvents="none">
      <rect
        fill={color}
        fillOpacity={0.14}
        height={16}
        rx={8}
        width={pillWidth}
        x={centerX - pillWidth / 2}
        y={centerY - 8}
      />
      <text dominantBaseline="central" fill={color} fontSize={10} textAnchor="middle" x={centerX} y={centerY}>
        {label}
      </text>
    </g>
  );
}

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
  activitiesEnabled = false,
  hideInlineCard = false,
  autoExpand = false,
  onCloseDialog
}: DayBreakdownChartProps) {
  const [isCompactAxis, setIsCompactAxis] = useState(false);
  const [utility, setUtility] = useState<"electricity" | "water">("electricity");
  const [dialogActivity, setDialogActivity] = useState<UsageActivity | null | undefined>(undefined);
  const [activeActivityIds, setActiveActivityIds] = useState<string[]>([]);
  const [activityCardAnchor, setActivityCardAnchor] = useState<DayDetailCardAnchor>();
  const [focusedTime, setFocusedTime] = useState<string>();
  const searchParams = useSearchParams();
  const activitiesHref = queryHref("/activities", new URLSearchParams(searchParams.toString()));
  const selectableDates = useMemo(() => new Set(dateOptions), [dateOptions]);
  const { data, isLoading: isLoadingIntervals } = useQuery({
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
  const dayActivities = useMemo(() => activityReport?.rows ?? [], [activityReport?.rows]);
  const activeActivities = useMemo(
    () => dayActivities.filter((activity) => activeActivityIds.includes(activity.id)),
    [activeActivityIds, dayActivities]
  );
  const activityOverlays = useMemo(() => {
    const nextDate = addDaysToIsoDate(selectedDate, 1);
    return assignIntervalLanes(
      dayActivities.flatMap((activity) => {
        const range = activityOverlayRange(activity, selectedDate);
        if (!range) return [];
        return [
          {
            activity,
            range,
            startTime: range.startTime,
            endTime: activity.endsAt >= `${nextDate}T00:00:00` ? "24:00" : activity.endsAt.slice(11, 16)
          }
        ];
      })
    );
  }, [dayActivities, selectedDate]);
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
          usageTickFormatter: (value: number) => formatUsageAxisTick(value, "kL"),
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
          usageTickFormatter: (value: number) => formatUsageAxisTick(value, "kWh"),
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

  useEffect(() => {
    setFocusedTime(undefined);
    setActiveActivityIds([]);
    setActivityCardAnchor(undefined);
  }, [selectedDate]);

  // Hover is driven by the chart's own mouse-tracking (activeLabel is the
  // nearest x-axis time under the cursor, computed from raw coordinates)
  // rather than per-ReferenceArea mouseenter/leave. Bar segments and the
  // range label are separate DOM elements stacked above the ReferenceArea's
  // rect, so hit-testing per-element flickered on/off as the cursor crossed
  // those internal boundaries even while staying inside one activity's span.
  const findActivitiesAtTime = (time?: string | number) => {
    if (time === undefined) return [];
    const label = String(time);
    return dayActivities.filter((activity) =>
      activityIncludesInterval(activity.startsAt, activity.endsAt, selectedDate, label)
    );
  };

  const focusActivitiesAtTime = (time: string | number | undefined, anchor: DayDetailCardAnchor) => {
    const activities = findActivitiesAtTime(time);
    setActiveActivityIds(activities.map((activity) => activity.id));
    if (activities.length) setActivityCardAnchor(anchor);
  };

  // The wrapper supplies a contained gutter for the outward-facing usage
  // labels, so the chart itself does not widen the page.
  const dayChartMargin = isCompactAxis ? { left: -8, right: 0, top: 8, bottom: 0 } : { ...chartMargin, right: 0 };
  const spendAxisWidth = isCompactAxis ? 34 : 48;
  const usageAxisWidth = isCompactAxis ? 38 : 42;

  const renderChart = (axisInterval: number, surface: DayDetailCardAnchor["surface"]) => (
    <div className="relative flex h-full flex-col">
      {isCompactAxis ? (
        <div className="pointer-events-none z-[1] flex h-7 w-full shrink-0 items-center px-3">
          {activityOverlays.length ? (
            <div className="flex min-w-0 flex-1 flex-nowrap justify-center gap-x-2 overflow-hidden whitespace-nowrap text-[0.6rem] leading-none text-muted">
              {activityOverlays.map(({ activity }, activityIndex) => (
                <span className="flex min-w-0 items-center gap-1" key={activity.id}>
                  <span
                    className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full font-semibold"
                    style={{
                      backgroundColor: `${activity.color ?? DEFAULT_ACTIVITY_COLOR}1f`,
                      color: activity.color ?? DEFAULT_ACTIVITY_COLOR
                    }}
                  >
                    {activityIndex + 1}
                  </span>
                  <span className="max-w-28 truncate">{displayActivityTag(activity.tags[0])}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        {isLoadingIntervals ? (
          <BarChartSkeleton label="day detail chart" />
        ) : (
          <ResponsiveContainer height="100%" width="100%">
            <ComposedChart
              data={intervalData}
              margin={dayChartMargin}
              onMouseMove={(state, event) => {
                if (state.activeLabel !== undefined) setFocusedTime(String(state.activeLabel));
                const chartX = state.chartX ?? 0;
                const focusX = state.activeCoordinate?.x ?? chartX;
                focusActivitiesAtTime(state.activeLabel, {
                  surface,
                  x: event.clientX - chartX + focusX,
                  top: event.clientY - (state.chartY ?? 0)
                });
              }}
              onClick={(state, event) => {
                const chartX = state.activeCoordinate?.x ?? state.chartX ?? 0;
                focusActivitiesAtTime(state.activeLabel, {
                  surface,
                  x: event.clientX - (state.chartX ?? 0) + chartX,
                  top: event.clientY - (state.chartY ?? 0)
                });
              }}
              onMouseLeave={(_, event) => {
                const nextTarget = event.relatedTarget;
                if (nextTarget instanceof Element && nextTarget.closest("[data-activity-card]")) return;
                setActiveActivityIds([]);
                setActivityCardAnchor(undefined);
              }}
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
                tickFormatter={formatCurrencyAxisTick}
                tickLine={false}
                axisLine={false}
                width={spendAxisWidth}
              />
              <YAxis
                yAxisId={utilityConfig.usageAxisId}
                domain={[0, utilityConfig.usageDomain]}
                orientation="right"
                tickFormatter={utilityConfig.usageTickFormatter}
                tickLine={false}
                axisLine={false}
                width={usageAxisWidth}
              />
              <Tooltip
                content={({ active, label, payload }) => {
                  if (!active || !payload?.length) return null;
                  const spendEntry = payload.find((entry) => entry.dataKey === utilityConfig.spendKey);
                  const usageEntry = payload.find((entry) => entry.dataKey === utilityConfig.usageKey);
                  const spendValue =
                    spendEntry?.value === undefined ? undefined : formatCurrency(Number(spendEntry.value));
                  const usageValue =
                    usageEntry?.value === undefined
                      ? undefined
                      : utilityConfig.usageFormatter(Number(usageEntry.value));

                  return (
                    <div className="rounded-lg border border-line bg-paper px-2 py-1.5 text-[0.7rem] shadow-soft">
                      <p className="leading-none text-muted">{label}</p>
                      <div className="mt-1 flex items-center gap-3 whitespace-nowrap font-medium text-ink">
                        {spendValue !== undefined ? (
                          <span
                            aria-label={`${utilityConfig.spendLabel}: ${spendValue}`}
                            className="flex items-center gap-1"
                          >
                            <span
                              aria-hidden="true"
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: chartColors.spend }}
                            />
                            {spendValue}
                          </span>
                        ) : null}
                        {usageValue !== undefined ? (
                          <span
                            aria-label={`${utilityConfig.usageLabel}: ${usageValue}`}
                            className="flex items-center gap-1"
                          >
                            <span
                              aria-hidden="true"
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: chartColors.usage }}
                            />
                            {usageValue}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                }}
              />
              {activityOverlays.map(({ activity, range }) => {
                const activityColor = activity.color ?? DEFAULT_ACTIVITY_COLOR;
                return (
                  <ReferenceArea
                    fill={activityColor}
                    fillOpacity={activity.allDay ? 0.04 : 0.07}
                    ifOverflow="extendDomain"
                    key={`${activity.id}-fill`}
                    stroke="none"
                    x1={range.startTime}
                    x2={range.endTime}
                    yAxisId="spend"
                  />
                );
              })}
              {activityOverlays.map(({ activity, range }, activityIndex) => {
                const activityColor = activity.color ?? DEFAULT_ACTIVITY_COLOR;
                return (
                  <ReferenceArea
                    fill="none"
                    key={`${activity.id}-border`}
                    stroke={activityColor}
                    strokeOpacity={1}
                    strokeWidth={1.5}
                    shape={(shapeProps) => <StaggeredActivityBorder {...shapeProps} lane={activityIndex} />}
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
                );
              })}
              {activityOverlays.map(({ activity, range }, activityIndex) => {
                const activityColor = activity.color ?? DEFAULT_ACTIVITY_COLOR;
                return (
                  <ReferenceArea
                    fill="none"
                    ifOverflow="extendDomain"
                    key={`${activity.id}-label`}
                    label={
                      isCompactAxis
                        ? { content: <ActivityNumberLabel color={activityColor} index={activityIndex} /> }
                        : {
                            content: (
                              <ActivityTextLabel
                                color={activityColor}
                                index={activityIndex}
                                label={displayActivityTag(activity.tags[0])}
                              />
                            )
                          }
                    }
                    stroke="none"
                    x1={range.startTime}
                    x2={range.endTime}
                    yAxisId="spend"
                  />
                );
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
        )}
      </div>
      {!isLoadingIntervals && activeActivities.length && activityCardAnchor?.surface === surface ? (
        <ActivityHoverCard activities={activeActivities} anchor={activityCardAnchor} onEdit={setDialogActivity} />
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
    <ExpandProvider autoExpand={autoExpand} onCollapse={onCloseDialog}>
      {!hideInlineCard ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3.5 sm:px-5">
            <h2 className="mr-auto text-base font-semibold text-ink">Day detail</h2>
            {/* On mobile the date/add controls drop to a full-width row of their
                own (order-last) so the expand button stays on the title line; on
                sm+ everything sits inline on one row. */}
            <div className="order-last flex w-full flex-wrap items-center justify-end gap-2 sm:order-none sm:w-auto">
              {dateControl}
              {activitiesEnabled ? addButton : null}
            </div>
            <ExpandChartButton />
          </div>
          <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[1fr_22rem]">
            <div className="h-72 sm:h-80">{renderChart(isCompactAxis ? 7 : 3, "inline")}</div>
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
      ) : null}
      <FullscreenChart
        title="Day detail"
        action={
          <>
            {dateControl}
            {activitiesEnabled ? addButton : null}
          </>
        }
      >
        {renderChart(3, "fullscreen")}
      </FullscreenChart>
      {activitiesEnabled ? (
        <ActivityDialog
          activity={dialogActivity ?? undefined}
          defaultDate={selectedDate}
          defaultStartTime={dialogActivity === null ? focusedTime : undefined}
          isOpen={dialogActivity !== undefined}
          onClose={() => setDialogActivity(undefined)}
        />
      ) : null}
    </ExpandProvider>
  );
}
