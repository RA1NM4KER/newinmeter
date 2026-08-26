"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency, formatKwh } from "@/lib/format";
import { chartColors, chartMargin } from "./chart-config";
import { ChartShell } from "./chart-shell";
import { chartTooltipProps } from "./chart-tooltip";
import type { HourlyChartProps } from "./types";

export function HourlyChart({ data, metric, title }: HourlyChartProps) {
  return (
    <ChartShell title={title}>
      <ResponsiveContainer height="100%" width="100%">
        <BarChart data={data} margin={chartMargin}>
          <CartesianGrid stroke={chartColors.line} vertical={false} />
          <XAxis dataKey="hour" interval={2} tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <Tooltip
            {...chartTooltipProps}
            formatter={(value) => [
              metric === "spend" ? formatCurrency(Number(value)) : formatKwh(Number(value)),
              metric
            ]}
          />
          <Bar
            dataKey={metric}
            fill={metric === "spend" ? chartColors.spend : chartColors.usage}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
