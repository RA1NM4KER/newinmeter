"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { chartDate, formatCurrency, formatCurrencyAxisTick } from "@/lib/format";
import { chartColors, chartMargin } from "./chart-config";
import { ChartShell } from "./chart-shell";
import { ChartTooltip } from "./chart-tooltip";
import type { DailyChartProps } from "./types";

export function CumulativeSpendChart({ data }: DailyChartProps) {
  return (
    <ChartShell title="Cumulative spend">
      <ResponsiveContainer height="100%" width="100%">
        <LineChart data={data} margin={chartMargin}>
          <CartesianGrid stroke={chartColors.line} vertical={false} />
          <XAxis dataKey="date" tickFormatter={chartDate} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={formatCurrencyAxisTick} tickLine={false} axisLine={false} width={56} />
          <ChartTooltip
            formatter={(value) => [formatCurrency(Number(value)), "Cumulative"]}
            labelFormatter={(label) => chartDate(String(label))}
          />
          <Line type="monotone" dataKey="cumulativeSpend" stroke={chartColors.ink} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
