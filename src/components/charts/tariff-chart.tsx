"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { roundedCeiling } from "@/lib/day-breakdown";
import { formatTariff } from "@/lib/format";
import { DropdownSelect, type DropdownOption } from "@/components/ui/dropdown-select";
import { chartColors, chartMargin, chartTooltipStyle } from "./chart-config";
import { ChartShell } from "./chart-shell";
import type { TariffChartProps } from "./types";

type TariffUtility = "electricity" | "water";

const utilityOptions: DropdownOption[] = [
  { label: "Electricity", value: "electricity" },
  { label: "Water", value: "water" }
];

const utilityLabel: Record<TariffUtility, string> = {
  electricity: "Tariff (R/kWh)",
  water: "Tariff (R/kL)"
};

export function TariffChart({ electricity, water }: TariffChartProps) {
  const [utility, setUtility] = useState<TariffUtility>("electricity");
  const data = utility === "water" ? water : electricity;

  // Recharts' default auto-domain rounds up to "nice" tick steps (0/2/4/6/8),
  // which can pad the axis well past the real max in range -- scale tightly
  // to the actual filtered data instead, recomputed whenever the range
  // (and therefore `data`) changes.
  const maxTariff = useMemo(() => roundedCeiling(Math.max(0, ...data.map((point) => point.tariff)), 0.5), [data]);

  return (
    <ChartShell
      title="Tariff bands"
      action={
        <DropdownSelect
          ariaLabel="Tariff utility"
          value={utility}
          options={utilityOptions}
          onChange={(value) => setUtility(value as TariffUtility)}
          className="w-32"
        />
      }
    >
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
          <Tooltip
            contentStyle={chartTooltipStyle}
            formatter={(value) => [formatTariff(Number(value)), utilityLabel[utility]]}
          />
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
