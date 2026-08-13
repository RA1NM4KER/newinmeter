"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { Pencil, Plus } from "lucide-react";
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
import type { ActivityReportRow, UsageActivity } from "@/lib/types";
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

type ActivityCardAnchor = {
  surface: "inline" | "fullscreen";
  x: number;
  top: number;
};

function ActivityHoverCard({
  activity,
  anchor,
  onEdit
}: {
  activity: ActivityReportRow;
  anchor: ActivityCardAnchor;
  onEdit: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number }>();

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const placeCard = () => {
      const edgeGap = 8;
      const { width, height } = card.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      setPosition({
        left: Math.max(
          viewportLeft + edgeGap,
          Math.min(anchor.x - width / 2, viewportRight - width - edgeGap)
        ),
        top: Math.max(viewportTop + edgeGap, Math.min(anchor.top + edgeGap, viewportBottom - height - edgeGap))
      });
    };

    placeCard();
    window.addEventListener("resize", placeCard);
    window.visualViewport?.addEventListener("resize", placeCard);
    window.visualViewport?.addEventListener("scroll", placeCard);
    return () => {
      window.removeEventListener("resize", placeCard);
      window.visualViewport?.removeEventListener("resize", placeCard);
      window.visualViewport?.removeEventListener("scroll", placeCard);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={cardRef}
      data-activity-card
      className="pointer-events-none fixed z-50 w-max max-w-[min(16rem,calc(100vw-1rem))] rounded-md border border-line bg-paper/95 p-2 text-[0.7rem] shadow-soft sm:max-w-[min(18rem,calc(100vw-1rem))] sm:p-3 sm:text-xs"
      style={{
        left: position?.left ?? anchor.x,
        top: position?.top ?? anchor.top,
        visibility: position ? "visible" : "hidden"
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-ink">{activityTimeLabel(activity)}</p>
        <button
          aria-label="Edit activity"
          className="pointer-events-auto -mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink"
          onClick={onEdit}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit();
          }}
          type="button"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-0.5 text-muted sm:mt-1">{activity.tags.map(displayActivityTag).join(", ")}</p>
      {activity.note ? <p className="mt-0.5 hidden text-muted sm:mt-1 sm:block">{activity.note}</p> : null}
      <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted sm:mt-2 sm:gap-y-1">
        <span>Electricity</span>
        <span className="text-right">{formatKwh(activity.electricityKwh)}</span>
        <span>Electricity spend</span>
        <span className="text-right">{formatCurrency(activity.electricitySpend)}</span>
        <span>Water</span>
        <span className="text-right">{formatKl(activity.waterKl)}</span>
        <span>Water spend</span>
        <span className="text-right">{formatCurrency(activity.waterSpend)}</span>
      </div>
    </div>,
    document.body
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
  activitiesEnabled = false
}: DayBreakdownChartProps) {
  const [isCompactAxis, setIsCompactAxis] = useState(false);
  const [utility, setUtility] = useState<"electricity" | "water">("electricity");
  const [dialogActivity, setDialogActivity] = useState<UsageActivity | null | undefined>(undefined);
  const [activeActivityId, setActiveActivityId] = useState<string>();
  const [activityCardAnchor, setActivityCardAnchor] = useState<ActivityCardAnchor>();
  const [focusedTime, setFocusedTime] = useState<string>();
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

  useEffect(() => {
    setFocusedTime(undefined);
    setActiveActivityId(undefined);
    setActivityCardAnchor(undefined);
  }, [selectedDate]);

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

  const renderChart = (axisInterval: number, surface: ActivityCardAnchor["surface"]) => (
    <div className="relative h-full">
      <ResponsiveContainer height="100%" width="100%">
        <ComposedChart
          data={intervalData}
          margin={chartMargin}
          onMouseMove={(state, event) => {
            const activity = findActivityAtTime(state.activeLabel);
            setActiveActivityId(activity?.id);
            if (state.activeLabel !== undefined) setFocusedTime(String(state.activeLabel));

            if (activity) {
              const chartX = state.chartX ?? 0;
              const focusX = state.activeCoordinate?.x ?? chartX;
              setActivityCardAnchor({
                surface,
                x: event.clientX - chartX + focusX,
                top: event.clientY - (state.chartY ?? 0)
              });
            }
          }}
          onMouseLeave={(_, event) => {
            const nextTarget = event.relatedTarget;
            if (nextTarget instanceof Element && nextTarget.closest("[data-activity-card]")) return;
            setActiveActivityId(undefined);
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
                onClick={(event) => {
                  setActiveActivityId(activity.id);
                  setActivityCardAnchor({
                    surface,
                    x: event.clientX,
                    top: event.currentTarget.ownerSVGElement?.getBoundingClientRect().top ?? event.clientY
                  });
                }}
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
      {activeActivity && activityCardAnchor?.surface === surface ? (
        <ActivityHoverCard
          activity={activeActivity}
          anchor={activityCardAnchor}
          onEdit={() => setDialogActivity(activeActivity)}
        />
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
