import { chartTooltipStyle } from "./chart-config";

const chartTooltipLabelStyle = {
  color: "rgb(var(--color-muted))"
};

const chartTooltipItemStyle = {
  color: "rgb(var(--color-ink))"
};

// Recharts must receive <Tooltip> as a direct chart child. Share its theme
// props instead of wrapping it, while overriding the #000 item fallback used
// when a series is coloured through <Cell>.
export const chartTooltipProps = {
  contentStyle: chartTooltipStyle,
  itemStyle: chartTooltipItemStyle,
  labelStyle: chartTooltipLabelStyle
};
