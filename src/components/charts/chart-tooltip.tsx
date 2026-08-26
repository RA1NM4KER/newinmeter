"use client";

import { type ComponentProps } from "react";
import { Tooltip as RechartsTooltip } from "recharts";
import { chartTooltipStyle } from "./chart-config";

const chartTooltipLabelStyle = {
  color: "rgb(var(--color-muted))"
};

const chartTooltipItemStyle = {
  color: "rgb(var(--color-ink))"
};

// Recharts assigns each default tooltip item an inline colour, falling back
// to #000 when a series is coloured through <Cell>. Centralising all three
// style layers prevents that fallback from bypassing NewinMeter's theme.
export function ChartTooltip(props: ComponentProps<typeof RechartsTooltip>) {
  return (
    <RechartsTooltip
      contentStyle={chartTooltipStyle}
      itemStyle={chartTooltipItemStyle}
      labelStyle={chartTooltipLabelStyle}
      {...props}
    />
  );
}
