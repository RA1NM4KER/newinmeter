"use client";

import { useEffect, useMemo, useState } from "react";
import { formatKwh, formatRand, spendFor, type DemoScenarioId } from "./demo-data";

type WindowId = "morning" | "afternoon" | "evening" | "lateNight";

const values = [
  0.1, 0.12, 0.18, 0.21, 0.3, 0.28, 0.22, 0.17, 0.14, 0.13, 0.12, 0.14, 0.16, 0.18, 0.17, 0.2, 0.19, 0.21, 0.18, 0.2,
  0.22, 0.24, 0.31, 0.46, 0.68, 0.82, 0.74, 0.51, 0.32, 0.25, 0.2, 0.22, 0.88, 1.46, 0.96, 0.39
];

const windows: Record<WindowId, { label: string; start: number; end: number; time: string; insight: string }> = {
  morning: {
    label: "Morning",
    start: 0,
    end: 8,
    time: "06:00–10:00",
    insight: "The morning rise stayed close to the recent weekday pattern."
  },
  afternoon: {
    label: "Afternoon",
    start: 12,
    end: 22,
    time: "12:00–17:00",
    insight: "Afternoon usage was steady, with no single interval standing out."
  },
  evening: {
    label: "Evening",
    start: 24,
    end: 28,
    time: "18:00–20:00",
    insight: "Usage was close to this household's normal evening pattern."
  },
  lateNight: {
    label: "Late night",
    start: 32,
    end: 36,
    time: "22:00–00:00",
    insight: "22:30 was Tuesday's largest late-night spike."
  }
};

const order: WindowId[] = ["morning", "afternoon", "evening", "lateNight"];

function timeForIndex(index: number) {
  const minutes = 6 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function windowForIndex(index: number): WindowId {
  if (index < 8) return "morning";
  if (index < 22) return "afternoon";
  if (index < 30) return "evening";
  return "lateNight";
}

type DayExplorerProps = {
  storyScenarioId?: DemoScenarioId;
  storySelectedTime?: string;
};

const storyWindow: Record<DemoScenarioId, WindowId> = {
  normal: "evening",
  evening: "evening",
  lateNight: "lateNight"
};

const storySelection: Record<DemoScenarioId, string> = {
  normal: "18:00",
  evening: "18:30",
  lateNight: "22:30"
};

function windowForTime(time: string): WindowId {
  const hour = Number(time.split(":")[0]);
  if (hour < 10) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "lateNight";
}

export function DayExplorer({ storyScenarioId, storySelectedTime }: DayExplorerProps = {}) {
  const [selectedId, setSelectedId] = useState<WindowId>("lateNight");
  const selected = windows[selectedId];
  const selectedUsage = useMemo(
    () => values.slice(selected.start, selected.end).reduce((total, value) => total + value, 0),
    [selected]
  );
  const maxValue = Math.max(...values);

  useEffect(() => {
    if (storySelectedTime) setSelectedId(windowForTime(storySelectedTime));
    else if (storyScenarioId) setSelectedId(storyWindow[storyScenarioId]);
  }, [storyScenarioId, storySelectedTime]);

  return (
    <section id="understand-day" aria-labelledby="day-heading" className="scroll-mt-16 bg-brandTeal text-white">
      <div className="border-y border-white/15">
        <div className="mx-auto flex max-w-[86rem] items-center justify-between gap-4 px-5 py-3 text-xs text-white/65 sm:px-8 lg:px-12">
          <span>
            {storySelectedTime ?? (storyScenarioId ? storySelection[storyScenarioId] : "22:30")} selected above
          </span>
          <span className="text-right text-white">Open Tuesday in full →</span>
        </div>
      </div>
      <div className="mx-auto max-w-[86rem] px-5 py-14 sm:px-8 sm:py-20 lg:px-12">
        <div className="grid gap-10 lg:grid-cols-[0.58fr_1.42fr] lg:gap-20">
          <div className="lg:pt-2">
            <p className="text-sm text-white/65">Tuesday · 12 August</p>
            <h2 id="day-heading" className="mt-3 max-w-md text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Every day has a shape.
            </h2>
            <p className="mt-4 max-w-sm text-base leading-7 text-white/70">
              The spike makes more sense when you can see the hours around it. Pick another part of Tuesday to compare.
            </p>

            <div className="mt-8 border-t border-white/20 pt-5">
              <p className="text-sm text-white/60">{selected.time}</p>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
                <p className="text-5xl font-semibold tracking-[-0.05em]">{formatRand(spendFor(selectedUsage))}</p>
                <p className="text-xl font-medium text-brandGreen">{formatKwh(selectedUsage)}</p>
              </div>
              <p className="mt-4 max-w-sm text-sm leading-6 text-white/75" aria-live="polite">
                {selected.insight}
              </p>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap gap-2" aria-label="Choose a time window">
              {order.map((id) => (
                <button
                  aria-pressed={selectedId === id}
                  className={`rounded-md border px-3 py-2 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-brandGreen focus-visible:ring-offset-2 focus-visible:ring-offset-brandTeal motion-reduce:transition-none ${
                    selectedId === id
                      ? "border-white bg-white text-brandTeal"
                      : "border-white/20 bg-transparent text-white/70 hover:border-white/45 hover:text-white"
                  }`}
                  key={id}
                  onClick={() => setSelectedId(id)}
                  type="button"
                >
                  {windows[id].label}
                </button>
              ))}
            </div>

            <div className="relative mt-8 h-64 border-b border-white/25 sm:mt-10 sm:h-80">
              <div className="pointer-events-none absolute inset-x-0 top-1/4 border-t border-white/10" />
              <div className="pointer-events-none absolute inset-x-0 top-2/4 border-t border-white/10" />
              <div className="pointer-events-none absolute inset-x-0 top-3/4 border-t border-white/10" />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 border-x border-white/20 bg-white/[0.045] transition-all duration-300 motion-reduce:transition-none"
                style={{
                  left: `${(selected.start / values.length) * 100}%`,
                  width: `${((selected.end - selected.start) / values.length) * 100}%`
                }}
              />
              <div className="absolute inset-0 flex items-end gap-1 sm:gap-1.5">
                {values.map((value, index) => {
                  const inWindow = index >= selected.start && index < selected.end;
                  return (
                    <button
                      aria-label={`${timeForIndex(index)}, ${formatKwh(value)}. Select ${windows[windowForIndex(index)].label}.`}
                      className="group flex h-full min-w-0 flex-1 items-end rounded-t-sm outline-none focus-visible:ring-2 focus-visible:ring-brandGreen"
                      key={`${index}-${value}`}
                      onClick={() => setSelectedId(windowForIndex(index))}
                      type="button"
                    >
                      <span
                        className={`block w-full rounded-t-[3px] transition-[height,background-color,opacity] duration-300 motion-reduce:transition-none ${
                          inWindow ? "bg-brandGreen" : "bg-white/30 group-hover:bg-white/55"
                        }`}
                        style={{ height: `${Math.max(5, (value / maxValue) * 100)}%` }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex justify-between text-xs text-white/55">
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>00:00</span>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-white/15 pt-4 text-xs text-white/55">
              <span>Energy usage · half-hour intervals</span>
              <span>Rate shown with each selection</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
