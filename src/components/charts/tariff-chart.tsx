"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { roundedCeiling } from "@/lib/day-breakdown";
import { formatTariff } from "@/lib/format";
import { chartColors, chartMargin, chartTooltipStyle } from "./chart-config";
import { ChartShell } from "./chart-shell";
import type { TariffChartProps } from "./types";

export function TariffChart({ data }: TariffChartProps) {
  // Recharts' default auto-domain rounds up to "nice" tick steps (0/2/4/6/8),
  // which can pad the axis well past the real max in range -- scale tightly
  // to the actual filtered data instead, recomputed whenever the range
  // (and therefore `data`) changes.
  const maxTariff = useMemo(() => roundedCeiling(Math.max(0, ...data.map((point) => point.tariff)), 0.5), [data]);

  return (
    <ChartShell title="Tariff bands" eyebrow="Daily average">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={data} margin={chartMargin}>
          <CartesianGrid stroke={chartColors.line} vertical={false} />
          <XAxis dataKey="dateLabel" tickLine={false} axisLine={false} />
          <YAxis
            domain={[0, maxTariff]}
            tickFormatter={(value) => `R${value}`}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [formatTariff(Number(value)), "Tariff"]} />
          <Area
            type="monotone"
            dataKey="tariff"
            stroke={chartColors.projection}
            fill="rgb(var(--color-projection) / 0.14)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: chartColors.projection, stroke: chartColors.paper, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
