"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import {
  demoScenarios,
  formatKwh,
  formatRand,
  scenarioOrder,
  spendFor,
  sumUsage,
  type DemoScenarioId
} from "./demo-data";

function endTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const next = hours * 60 + minutes + 30;
  return `${String(Math.floor(next / 60) % 24).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`;
}

export function EnergyPlayground() {
  const [scenarioId, setScenarioId] = useState<DemoScenarioId>("lateNight");
  const scenario = demoScenarios[scenarioId];
  const [selectedIndex, setSelectedIndex] = useState(scenario.focusIndex);
  const [assistantState, setAssistantState] = useState<"closed" | "thinking" | "open">("closed");

  useEffect(() => {
    setSelectedIndex(scenario.focusIndex);
    setAssistantState("closed");
  }, [scenario]);

  useEffect(() => {
    if (assistantState !== "thinking") return;
    const timer = window.setTimeout(() => setAssistantState("open"), 420);
    return () => window.clearTimeout(timer);
  }, [assistantState]);

  const totalKwh = useMemo(() => sumUsage(scenario.points), [scenario.points]);
  const selected = scenario.points[selectedIndex];
  const selectedSpend = spendFor(selected.kwh);
  const maxKwh = Math.max(...scenario.points.map((point) => point.kwh));
  const activity = scenario.activity;
  const overlapsActivity = Boolean(
    activity && selectedIndex >= activity.startIndex && selectedIndex < activity.endIndex
  );

  function chooseScenario(id: DemoScenarioId) {
    setScenarioId(id);
  }

  function choosePoint(index: number) {
    setSelectedIndex(index);
    setAssistantState("closed");
  }

  function openAssistant() {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAssistantState(reducedMotion ? "open" : "thinking");
  }

  return (
    <section
      aria-label="Illustrative NewinMeter playground"
      className="relative overflow-hidden border border-ink/10 bg-paper shadow-[0_28px_80px_rgba(1,99,113,0.13)]"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brandTeal">Tuesday · 12 August</p>
          <p className="mt-0.5 text-xs text-muted">Illustrative data · Electricity</p>
        </div>
        <span className="rounded-md border border-line bg-canvas px-2 py-1 text-xs font-medium text-muted">30 min</span>
      </div>

      <div className="px-4 pb-5 pt-5 sm:px-6 sm:pb-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted">Energy spend</p>
            <p className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-4xl">
              {formatRand(spendFor(totalKwh))}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">Energy usage</p>
            <p className="mt-1 text-lg font-semibold text-ink sm:text-xl">{formatKwh(totalKwh)}</p>
          </div>
        </div>

        <div className="relative mt-7 h-44 border-b border-line sm:h-52">
          <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-line/70" />
          <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-line/70" />
          {activity ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 border-x border-brandTeal/30 bg-brandTeal/[0.055] transition-all duration-300 motion-reduce:transition-none"
              style={{
                left: `${(activity.startIndex / scenario.points.length) * 100}%`,
                width: `${((activity.endIndex - activity.startIndex) / scenario.points.length) * 100}%`
              }}
            />
          ) : null}
          <div className="absolute inset-0 flex items-end gap-1 sm:gap-1.5">
            {scenario.points.map((point, index) => {
              const selectedPoint = selectedIndex === index;
              const inActivity = Boolean(activity && index >= activity.startIndex && index < activity.endIndex);
              return (
                <button
                  aria-label={`${point.time}, ${formatKwh(point.kwh)}${inActivity ? `, overlaps ${activity?.label}` : ""}`}
                  aria-pressed={selectedPoint}
                  className="group flex h-full min-w-0 flex-1 items-end rounded-t-sm outline-none focus-visible:ring-2 focus-visible:ring-brandTeal focus-visible:ring-offset-2"
                  key={point.time}
                  onClick={() => choosePoint(index)}
                  type="button"
                >
                  <span
                    className={`block w-full rounded-t-[3px] transition-[height,background-color,opacity,transform] duration-300 motion-reduce:transition-none group-hover:opacity-100 ${
                      selectedPoint
                        ? "bg-brandTeal"
                        : inActivity
                          ? "bg-accent opacity-90"
                          : "bg-accent opacity-65 group-hover:opacity-90"
                    }`}
                    style={{ height: `${Math.max(7, (point.kwh / maxKwh) * 100)}%` }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>12:00</span>
          <span>18:00</span>
          <span>23:30</span>
        </div>

        <div className="mt-5 grid gap-3 border-y border-line py-4 sm:grid-cols-[0.8fr_0.65fr_1.2fr] sm:gap-5">
          <div>
            <p className="text-xs text-muted">Selected window</p>
            <p className="mt-1 text-sm font-semibold text-ink">
              {selected.time}–{endTime(selected.time)}
            </p>
          </div>
          <div className="flex gap-5 sm:block">
            <p className="text-sm font-semibold text-ink">{formatKwh(selected.kwh)}</p>
            <p className="mt-1 text-xs text-muted">{formatRand(selectedSpend)} spend</p>
          </div>
          <div>
            <p className="text-xs text-muted">Activity overlap</p>
            <p className={`mt-1 text-sm font-medium ${overlapsActivity ? "text-brandTeal" : "text-muted"}`}>
              {overlapsActivity && activity ? `${activity.label} · ${activity.time}` : "None recorded"}
            </p>
          </div>
        </div>

        <p className="mt-4 min-h-10 text-sm leading-6 text-muted">{scenario.insight}</p>

        <div className="mt-4 flex flex-wrap gap-2" aria-label="Choose an illustrative usage scenario">
          {scenarioOrder.map((id) => (
            <button
              aria-pressed={scenarioId === id}
              className={`rounded-md border px-3 py-2 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 motion-reduce:transition-none ${
                scenarioId === id
                  ? "border-brandTeal bg-brandTeal text-white"
                  : "border-line bg-paper text-muted hover:border-brandTeal/40 hover:text-ink"
              }`}
              key={id}
              onClick={() => chooseScenario(id)}
              type="button"
            >
              {demoScenarios[id].label}
            </button>
          ))}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          {assistantState === "closed" ? (
            <button
              className="group inline-flex items-center gap-2 text-sm font-semibold text-ink outline-none hover:text-brandTeal focus-visible:ring-2 focus-visible:ring-accent"
              onClick={openAssistant}
              type="button"
            >
              Ask NewinMeter why
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </button>
          ) : assistantState === "thinking" ? (
            <div className="flex items-center gap-2 text-sm text-muted" role="status">
              <span className="flex gap-1" aria-hidden="true">
                {[0, 1, 2].map((index) => (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-assistantProgressDot"
                    key={index}
                    style={{ animationDelay: `${index * 0.18}s` }}
                  />
                ))}
              </span>
              Looking at Tuesday…
            </div>
          ) : (
            <div className="public-demo-answer" role="status">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brandTeal">NewinMeter</p>
              <p className="mt-2 max-w-lg text-sm leading-6 text-ink">{scenario.assistant}</p>
              {overlapsActivity && activity ? (
                <p className="mt-2 text-xs text-muted">
                  {formatKwh(selected.kwh)} was recorded during the period labelled {activity.label}.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
