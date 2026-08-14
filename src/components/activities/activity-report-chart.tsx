"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { activityTimeLabel, displayActivityTag } from "@/lib/activity-utils";
import { chartDate, formatCurrencyAxisTick } from "@/lib/format";
import type { ActivityMetric, ActivityReportRow } from "@/lib/types";
import { chartColors, chartMargin } from "@/components/charts/chart-config";
import { formatActivityMetric } from "./activity-report-model";

export const activityMetricOptions: Array<{ label: string; value: ActivityMetric }> = [
  { label: "Electricity usage, kWh", value: "electricityKwh" },
  { label: "Average demand, kW", value: "averageKw" },
  { label: "Electricity spend, R", value: "electricitySpend" },
  { label: "Water usage, kL", value: "waterKl" },
  { label: "Water spend, R", value: "waterSpend" }
];

export function ActivityReportChart({ rows, metric }: { rows: ActivityReportRow[]; metric: ActivityMetric }) {
  return (
    <ResponsiveContainer height="100%" width="100%">
      <BarChart data={rows} margin={chartMargin}>
        <CartesianGrid stroke={chartColors.line} vertical={false} />
        <XAxis dataKey="date" tickFormatter={chartDate} tickLine={false} axisLine={false} />
        <YAxis
          tickFormatter={(value) => (metric.includes("Spend") ? formatCurrencyAxisTick(Number(value)) : `${value}`)}
          tickLine={false}
          axisLine={false}
          width={46}
        />
        <Tooltip
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as ActivityReportRow | undefined;
            if (!active || !row) return null;
            return (
              <div className="max-w-72 rounded-md border border-line bg-paper px-4 py-3 text-sm shadow-soft">
                <p className="font-medium text-ink">
                  {chartDate(row.date)} · {activityTimeLabel(row)}
                </p>
                <p className="mt-1 text-muted">{row.tags.map(displayActivityTag).join(", ")}</p>
                {row.note ? <p className="mt-1 text-xs text-muted">{row.note}</p> : null}
                <p className="mt-2 text-ink">{formatActivityMetric(metric, row[metric])}</p>
              </div>
            );
          }}
        />
        <Bar dataKey={metric} radius={[4, 4, 0, 0]}>
          {rows.map((row) => (
            <Cell fill={row.color} key={row.id} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
