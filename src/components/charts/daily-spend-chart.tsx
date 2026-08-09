"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { chartDate, formatCurrency } from "@/lib/format";
import { chartColors, chartMargin } from "./chart-config";
import { ChartShell } from "./chart-shell";
import { buildDailySpendChartModel } from "./daily-spend-chart-model";
import type { DailyChartProps } from "./types";

export function DailySpendChart({ data }: DailyChartProps) {
  const { projectedDay, completedDays, averageSpend, chartData, currentDaySegment } = buildDailySpendChartModel(data);

  return (
    <ChartShell title="Daily spend" titleAdornment="incl. fixed">
      <ResponsiveContainer height="100%" width="100%">
        <ComposedChart data={chartData} margin={chartMargin}>
          <CartesianGrid stroke={chartColors.line} vertical={false} />
          <XAxis dataKey="date" tickFormatter={chartDate} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={(value) => `R${value}`} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            content={({ active, label }) => {
              if (!active || !label) {
                return null;
              }

              const point = chartData.find((item) => item.date === String(label));
              if (!point) {
                return null;
              }

              const isProjectedPoint = projectedDay?.date === point.date;

              return (
                <div className="rounded-[8px] border border-line bg-paper px-4 py-3 text-sm shadow-soft">
                  <div className="mb-2 font-medium text-ink">{chartDate(point.date)}</div>
                  {isProjectedPoint ? (
                    <div className="space-y-1 text-muted">
                      <div>Current spend: {formatCurrency(point.spend)}</div>
                      <div>Projected spend: {formatCurrency(point.projectedSpendValue ?? point.spend)}</div>
                    </div>
                  ) : (
                    <div className="text-muted">Spend: {formatCurrency(point.spend)}</div>
                  )}
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="actualSpend"
            stroke={chartColors.spend}
            fill={chartColors.spend}
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: chartColors.spend, stroke: chartColors.paper, strokeWidth: 2 }}
          />
          <Line
            dataKey="currentSpend"
            stroke="transparent"
            strokeWidth={8}
            dot={{ r: 4, fill: chartColors.spend, stroke: chartColors.paper, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: chartColors.spend, stroke: chartColors.paper, strokeWidth: 2 }}
          />
          <Line dataKey="projectedSpendValue" stroke="transparent" strokeWidth={8} dot={false} activeDot={false} />
          {completedDays.length ? (
            <ReferenceLine y={averageSpend} stroke={chartColors.average} strokeDasharray="4 4" strokeWidth={1.5} />
          ) : null}
          {currentDaySegment ? (
            <ReferenceLine
              isFront
              segment={currentDaySegment}
              stroke={chartColors.spend}
              strokeDasharray="4 4"
              strokeWidth={2}
            />
          ) : null}
          {projectedDay ? (
            <ReferenceDot
              isFront
              x={projectedDay.date}
              y={projectedDay.projectedSpend}
              r={4}
              fill={chartColors.projection}
              stroke={chartColors.paper}
              strokeWidth={2}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
