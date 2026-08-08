"use client";

import { memo, useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { formatClockTime } from "@/lib/live-format";
import { formatLoad, niceWattsDomain } from "@/lib/live-meter-calc";
import type { SeriesPoint } from "@/lib/live-meter-types";
import { chartColors, chartMargin, chartTooltipStyle } from "@/components/charts/chart-config";

type LiveChartProps = {
  series: SeriesPoint[];
  // Stale: keep the historical curve visible but mute its colour rather than
  // hiding data or greying the whole page.
  muted?: boolean;
};

type ChartDatum = { t: number; watts: number };

function LiveTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartDatum }> }) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const datum = payload[0].payload;
  const load = formatLoad(datum.watts);
  return (
    <div className="rounded-lg border border-line bg-paper/95 px-3 py-2 text-xs shadow-soft">
      <p className="font-medium tabular-nums text-ink">
        {load.value} {load.unit}
      </p>
      <p className="mt-0.5 text-muted">{formatClockTime(new Date(datum.t).toISOString())}</p>
    </div>
  );
}

function LiveChartImpl({ series, muted = false }: LiveChartProps) {
  const gradientId = useId();
  const data = useMemo<ChartDatum[]>(
    () => series.map((point) => ({ t: Date.parse(point.timestamp), watts: point.watts })),
    [series]
  );

  // Quantised, stable Y domain (see niceWattsDomain): in-range fluctuation
  // leaves the scale -- and thus every point's vertical position -- unchanged,
  // so a refetch of effectively identical data does not make the graph breathe.
  const { domain, useKw } = useMemo(() => {
    const [low, high] = niceWattsDomain(data.map((d) => d.watts));
    return { domain: [low, high] as [number, number], useKw: high >= 1000 };
  }, [data]);

  const stroke = muted ? chartColors.average : chartColors.accent;
  // Unit on the tick labels themselves (matches the mockup), so no floating
  // corner label is needed.
  const yTickFormatter = (value: number) => (useKw ? `${(value / 1000).toFixed(1)} kW` : `${Math.round(value)} W`);
  const xTickFormatter = (value: number) => formatClockTime(new Date(value).toISOString());

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
        Waiting for readings to plot.
      </div>
    );
  }

  const last = data[data.length - 1];
  const lastLoad = formatLoad(last.watts);

  return (
    <div
      className="relative h-full"
      role="img"
      aria-label={`Estimated electrical load over the selected window; latest reading ${lastLoad.value} ${lastLoad.unit}.`}
    >
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart data={data} margin={chartMargin}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={muted ? 0.06 : 0.14} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={chartColors.line} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={xTickFormatter}
            tick={{ fontSize: 11 }}
            minTickGap={56}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={yTickFormatter}
            tick={{ fontSize: 11 }}
            width={54}
            tickLine={false}
            axisLine={false}
            domain={domain}
            allowDecimals={false}
          />
          <Tooltip content={<LiveTooltip />} cursor={{ stroke: chartColors.line }} />
          {/* "now" sits at the right edge -- a quiet dashed marker. */}
          <ReferenceLine x={last.t} stroke={chartColors.projection} strokeDasharray="3 4" strokeOpacity={0.5} />
          <Area
            type="monotone"
            dataKey="watts"
            stroke={stroke}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
          {/* Latest point: soft halo + crisp marker, matching the mockup. */}
          <ReferenceDot x={last.t} y={last.watts} r={7} fill={stroke} fillOpacity={0.16} stroke="none" />
          <ReferenceDot x={last.t} y={last.watts} r={3.5} fill={chartColors.paper} stroke={stroke} strokeWidth={2.4} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function seriesEqual(a: SeriesPoint[], b: SeriesPoint[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].timestamp !== b[i].timestamp || a[i].watts !== b[i].watts) {
      return false;
    }
  }
  return true;
}

// Memoised with a DEEP series comparison, so:
//  - the parent's 1-second "last pulse Xs ago" timer never touches the chart;
//  - a poll / realtime refetch that returns byte-identical values (a new array
//    reference, same numbers) is a no-op -- the chart does not even re-render,
//    guaranteeing it stays pixel-identical when the load hasn't changed.
// It re-renders only when the series values or the muted flag actually change.
export const LiveChart = memo(
  LiveChartImpl,
  (prev, next) => prev.muted === next.muted && seriesEqual(prev.series, next.series)
);
