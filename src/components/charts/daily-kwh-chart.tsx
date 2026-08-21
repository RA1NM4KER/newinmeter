"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { displayActivityTag } from "@/lib/activity/utils";
import { chartDate, formatKwh } from "@/lib/format";
import { chartColors, chartMargin } from "./chart-config";
import { ChartShell } from "./chart-shell";
import { buildDailyKwhChartModel, groupActivitiesByDate } from "./daily-kwh-chart-model";
import { ProjectedBarShape } from "./projected-bar-shape";
import type { DailyChartProps } from "./types";

export function DailyKwhChart({ data, activities = [], onSelectDate }: DailyChartProps) {
  const { chartData, completedDays, averageKwh } = buildDailyKwhChartModel(data);
  const activitiesByDate = groupActivitiesByDate(activities);
  const chartMaximum = Math.max(
    1,
    averageKwh,
    ...chartData.map((point) => Math.max(point.kwh, point.projectedKwh ?? 0))
  );

  return (
    <ChartShell title="Daily usage">
      <ResponsiveContainer height="100%" width="100%">
        <BarChart data={chartData} margin={chartMargin}>
          <CartesianGrid stroke={chartColors.line} vertical={false} />
          <XAxis dataKey="date" tickFormatter={chartDate} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={(value) => `${value}`} tickLine={false} axisLine={false} width={42} />
          <Tooltip
            content={({ active, label }) => {
              if (!active || !label) {
                return null;
              }

              const point = chartData.find((item) => item.date === String(label));
              if (!point) {
                return null;
              }

              return (
                <div className="rounded-[8px] border border-line bg-paper px-4 py-3 text-sm shadow-soft">
                  <div className="mb-2 font-medium text-ink">{chartDate(point.date)}</div>
                  {typeof point.projectedKwh === "number" ? (
                    <div className="space-y-1 text-muted">
                      <div>Current usage: {formatKwh(point.kwh)}</div>
                      <div>Projected usage: {formatKwh(point.projectedKwh)}</div>
                    </div>
                  ) : (
                    <div className="text-muted">Usage: {formatKwh(point.kwh)}</div>
                  )}
                  {activitiesByDate[point.date]?.length ? (
                    <div className="mt-2 border-t border-line pt-2 text-muted">
                      <div>
                        {activitiesByDate[point.date].length}{" "}
                        {activitiesByDate[point.date].length === 1 ? "activity" : "activities"}
                      </div>
                      <div className="mt-0.5 text-xs">
                        {Array.from(new Set(activitiesByDate[point.date].flatMap((activity) => activity.tags)))
                          .map(displayActivityTag)
                          .join(", ")}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            }}
          />
          <Bar
            dataKey="kwh"
            stackId="day"
            fill={chartColors.usage}
            radius={[4, 4, 0, 0]}
            onClick={(entry) => {
              const date = typeof entry === "object" && entry && "date" in entry ? String(entry.date) : "";
              if (date && activitiesByDate[date]?.length) onSelectDate?.(date);
            }}
          />
          <Bar dataKey="projectedKwhRemainder" stackId="day" fill="transparent" shape={<ProjectedBarShape />} />
          {completedDays.length ? (
            <ReferenceLine y={averageKwh} stroke={chartColors.average} strokeDasharray="4 4" strokeWidth={1.5} />
          ) : null}
          {chartData
            .filter((point) => activitiesByDate[point.date]?.length)
            .map((point) => (
              <ReferenceDot
                cursor={onSelectDate ? "pointer" : undefined}
                fill={chartColors.spend}
                ifOverflow="extendDomain"
                isFront
                key={point.date}
                onClick={() => onSelectDate?.(point.date)}
                r={3.5}
                stroke={chartColors.paper}
                strokeWidth={2}
                x={point.date}
                y={Math.max(point.kwh, point.projectedKwh ?? 0) + chartMaximum * 0.035}
              />
            ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
