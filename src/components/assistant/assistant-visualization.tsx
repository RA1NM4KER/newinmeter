"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColors, chartMargin, chartTooltipStyle } from "@/components/charts/chart-config";
import { formatCurrency, formatKwh } from "@/lib/format";
import { buildDailyRollupsUrl, buildDayIntervalsUrl } from "@/lib/endpoints";
import type { AssistantVisualization } from "@/lib/assistant/types";
import type { DailyRollupRow, IntervalRollupRow } from "@/lib/types";

// Every visualization here loads REAL NewinMeter data from the app's own
// existing, RLS-scoped endpoints (day-intervals, daily-rollups) -- the model
// only ever picks WHICH view and WHAT to highlight (see the AssistantVisualization
// union); it never supplies chart numbers itself.

function ChartFrame({ children, loading, empty }: { children: ReactNode; loading: boolean; empty: boolean }) {
  if (loading) {
    return <div className="h-36 animate-pulse rounded-md bg-canvas" />;
  }
  if (empty) {
    return (
      <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-line text-xs text-muted">
        No data for this range.
      </div>
    );
  }
  return <div className="h-36 w-full">{children}</div>;
}

function isHourHighlighted(hour: number, highlights: { fromHour: number; toHour: number }[]): boolean {
  return highlights.some((range) => hour >= range.fromHour && hour < range.toHour);
}

function HourlyUsageChart({
  date,
  highlights
}: {
  date: string;
  highlights: { fromHour: number; toHour: number; label: string | null }[];
}) {
  const [rows, setRows] = useState<IntervalRollupRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetch(buildDayIntervalsUrl(date))
      .then((response) => (response.ok ? response.json() : { rows: [] }))
      .then((body: { rows?: IntervalRollupRow[] }) => {
        if (!cancelled) setRows(body.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, kwh: 0 }));
  for (const row of rows ?? []) {
    const hour = Number(row.periodTime.slice(0, 2));
    if (Number.isFinite(hour) && hourly[hour]) {
      hourly[hour].kwh += row.kwh;
    }
  }
  const hasData = (rows?.length ?? 0) > 0;
  const labeledHighlights = highlights.filter((range) => range.label);

  return (
    <div>
      <ChartFrame loading={rows === null} empty={rows !== null && !hasData}>
        <ResponsiveContainer height="100%" width="100%">
          <BarChart data={hourly} margin={chartMargin}>
            <CartesianGrid stroke={chartColors.line} vertical={false} />
            <XAxis dataKey="hour" interval={3} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
            <YAxis hide />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value) => [formatKwh(Number(value)), "usage"]}
              labelFormatter={(hour) => `${hour}:00`}
            />
            <Bar dataKey="kwh" radius={[3, 3, 0, 0]}>
              {hourly.map((point) => (
                <Cell
                  fill={isHourHighlighted(point.hour, highlights) ? chartColors.spend : chartColors.usage}
                  key={point.hour}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
      {labeledHighlights.length ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {labeledHighlights.map((range, index) => (
            <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted" key={index}>
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: chartColors.spend }}
              />
              {range.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DailyUsageChart({ from, to, highlightDate }: { from: string; to: string; highlightDate: string | null }) {
  const [rows, setRows] = useState<DailyRollupRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    fetch(buildDailyRollupsUrl({ from, to }))
      .then((response) => (response.ok ? response.json() : { rows: [] }))
      .then((body: { rows?: DailyRollupRow[] }) => {
        if (!cancelled) setRows(body.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const data = (rows ?? []).map((row) => ({
    date: row.periodDate.slice(5),
    fullDate: row.periodDate,
    spend: row.totalSpend
  }));

  return (
    <ChartFrame loading={rows === null} empty={rows !== null && data.length === 0}>
      <ResponsiveContainer height="100%" width="100%">
        <BarChart data={data} margin={chartMargin}>
          <CartesianGrid stroke={chartColors.line} vertical={false} />
          <XAxis dataKey="date" interval="preserveStartEnd" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
          <YAxis hide />
          <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [formatCurrency(Number(value)), "spend"]} />
          <Bar dataKey="spend" radius={[3, 3, 0, 0]}>
            {data.map((point) => (
              <Cell
                fill={point.fullDate === highlightDate ? chartColors.accent : chartColors.spend}
                key={point.fullDate}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function PeriodComparisonView({
  currentFrom,
  currentTo,
  previousFrom,
  previousTo
}: {
  currentFrom: string;
  currentTo: string;
  previousFrom: string;
  previousTo: string;
}) {
  const [totals, setTotals] = useState<{
    current: { spend: number; kwh: number };
    previous: { spend: number; kwh: number };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTotals(null);

    function sum(rows: DailyRollupRow[]) {
      return rows.reduce((acc, row) => ({ spend: acc.spend + row.totalSpend, kwh: acc.kwh + row.energyKwh }), {
        spend: 0,
        kwh: 0
      });
    }

    Promise.all([
      fetch(buildDailyRollupsUrl({ from: currentFrom, to: currentTo })).then((r) => (r.ok ? r.json() : { rows: [] })),
      fetch(buildDailyRollupsUrl({ from: previousFrom, to: previousTo })).then((r) => (r.ok ? r.json() : { rows: [] }))
    ])
      .then(([currentBody, previousBody]: [{ rows?: DailyRollupRow[] }, { rows?: DailyRollupRow[] }]) => {
        if (cancelled) return;
        setTotals({ current: sum(currentBody.rows ?? []), previous: sum(previousBody.rows ?? []) });
      })
      .catch(() => {
        if (!cancelled) setTotals({ current: { spend: 0, kwh: 0 }, previous: { spend: 0, kwh: 0 } });
      });
    return () => {
      cancelled = true;
    };
  }, [currentFrom, currentTo, previousFrom, previousTo]);

  if (!totals) {
    return <div className="h-20 animate-pulse rounded-md bg-canvas" />;
  }

  const spendDelta = totals.current.spend - totals.previous.spend;
  const kwhDelta = totals.current.kwh - totals.previous.kwh;

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-md border border-line/70 bg-canvas/40 px-3 py-2.5">
        <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted">Spend</p>
        <p className="mt-1 text-base font-semibold text-ink">{formatCurrency(totals.current.spend)}</p>
        <p className={`mt-0.5 text-xs ${spendDelta > 0 ? "text-red-600" : "text-brandGreen"}`}>
          {spendDelta >= 0 ? "+" : ""}
          {formatCurrency(spendDelta)} vs previous
        </p>
      </div>
      <div className="rounded-md border border-line/70 bg-canvas/40 px-3 py-2.5">
        <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted">Usage</p>
        <p className="mt-1 text-base font-semibold text-ink">{formatKwh(totals.current.kwh)}</p>
        <p className={`mt-0.5 text-xs ${kwhDelta > 0 ? "text-red-600" : "text-brandGreen"}`}>
          {kwhDelta >= 0 ? "+" : ""}
          {formatKwh(kwhDelta)} vs previous
        </p>
      </div>
    </div>
  );
}

export function AssistantVisualizationCard({ visualization }: { visualization: AssistantVisualization }) {
  return (
    <div className="rounded-lg bg-canvas/50 p-3">
      {visualization.title ? <p className="mb-2 text-xs font-medium text-muted">{visualization.title}</p> : null}
      {visualization.type === "hourly_usage" ? (
        <HourlyUsageChart date={visualization.date} highlights={visualization.highlights} />
      ) : visualization.type === "daily_usage" ? (
        <DailyUsageChart from={visualization.from} to={visualization.to} highlightDate={visualization.highlightDate} />
      ) : (
        <PeriodComparisonView
          currentFrom={visualization.currentFrom}
          currentTo={visualization.currentTo}
          previousFrom={visualization.previousFrom}
          previousTo={visualization.previousTo}
        />
      )}
    </div>
  );
}
