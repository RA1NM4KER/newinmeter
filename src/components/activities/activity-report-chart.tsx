"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartDate, formatCurrencyAxisTick } from "@/lib/format";
import type { ActivityMetric, ActivityReportRow } from "@/lib/types";
import { ActivityHoverCard, type ActivityCardAnchor } from "@/components/charts/activity-hover-card";
import { chartColors, chartMargin } from "@/components/charts/chart-config";

export const activityMetricOptions: Array<{ label: string; value: ActivityMetric }> = [
  { label: "Electricity usage, kWh", value: "electricityKwh" },
  { label: "Average demand, kW", value: "averageKw" },
  { label: "Electricity spend, R", value: "electricitySpend" },
  { label: "Water usage, kL", value: "waterKl" },
  { label: "Water spend, R", value: "waterSpend" }
];

export function ActivityReportChart({
  rows,
  metric,
  onEdit,
  onJumpToDay
}: {
  rows: ActivityReportRow[];
  metric: ActivityMetric;
  onEdit: (activity: ActivityReportRow) => void;
  onJumpToDay: (activity: ActivityReportRow) => void;
}) {
  const [activeActivity, setActiveActivity] = useState<ActivityReportRow>();
  const [anchor, setAnchor] = useState<ActivityCardAnchor>();

  // Each bar is already exactly one activity, so hover/click just needs the
  // payload under the cursor -- no time-range matching like the day-detail
  // chart (which can have several overlapping activities at once).
  const focusActivity = (row: ActivityReportRow | undefined, nextAnchor: ActivityCardAnchor) => {
    setActiveActivity(row);
    if (row) setAnchor(nextAnchor);
  };

  // Both card actions open something on top of the page (an edit dialog, or
  // the day detail dialog) without the mouse ever leaving the chart, so the
  // chart's own onMouseLeave never fires to dismiss this hover card -- it'd
  // otherwise sit rendered (and, being a fixed-position portal, visible) on
  // top of whatever just opened.
  const dismissAndRun =
    <T,>(action: (value: T) => void) =>
    (value: T) => {
      setActiveActivity(undefined);
      setAnchor(undefined);
      action(value);
    };

  return (
    <div className="relative h-full">
      <ResponsiveContainer height="100%" width="100%">
        <BarChart
          data={rows}
          margin={chartMargin}
          onMouseMove={(state, event) => {
            const row = state.activePayload?.[0]?.payload as ActivityReportRow | undefined;
            const chartX = state.chartX ?? 0;
            const focusX = state.activeCoordinate?.x ?? chartX;
            focusActivity(row, { x: event.clientX - chartX + focusX, top: event.clientY - (state.chartY ?? 0) });
          }}
          onClick={(state, event) => {
            const row = state.activePayload?.[0]?.payload as ActivityReportRow | undefined;
            const chartX = state.activeCoordinate?.x ?? state.chartX ?? 0;
            focusActivity(row, {
              x: event.clientX - (state.chartX ?? 0) + chartX,
              top: event.clientY - (state.chartY ?? 0)
            });
          }}
          onMouseLeave={(_, event) => {
            const nextTarget = event.relatedTarget;
            if (nextTarget instanceof Element && nextTarget.closest("[data-activity-card]")) return;
            setActiveActivity(undefined);
            setAnchor(undefined);
          }}
        >
          <CartesianGrid stroke={chartColors.line} vertical={false} />
          <XAxis dataKey="date" tickFormatter={chartDate} tickLine={false} axisLine={false} />
          <YAxis
            tickFormatter={(value) => (metric.includes("Spend") ? formatCurrencyAxisTick(Number(value)) : `${value}`)}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          {/* Content-less: only here for the same hover-cursor shadow every
              other bar chart gets from Tooltip -- ActivityHoverCard is the
              real hover UI, driven by the chart's own mouse tracking above. */}
          <Tooltip content={() => null} />
          <Bar dataKey={metric} radius={[4, 4, 0, 0]}>
            {rows.map((row) => (
              <Cell fill={row.color} key={row.id} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {activeActivity && anchor ? (
        <ActivityHoverCard
          activities={[activeActivity]}
          anchor={anchor}
          onEdit={dismissAndRun(onEdit)}
          onJumpToDay={dismissAndRun(onJumpToDay)}
        />
      ) : null}
    </div>
  );
}
