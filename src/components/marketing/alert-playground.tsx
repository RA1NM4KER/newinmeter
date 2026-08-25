"use client";

import { useState } from "react";
import { Bell, Check, Minus, Plus, RefreshCw } from "lucide-react";

type AlertId = "dailySpend" | "lowBalance" | "runway";

type AlertDefinition = {
  label: string;
  title: string;
  current: number;
  unit: "currency" | "days";
  step: number;
  min: number;
  max: number;
  condition: (current: number, threshold: number) => boolean;
  notification: (current: number, threshold: number) => string;
  waiting: (current: number, threshold: number) => string;
};

const alertDefinitions: Record<AlertId, AlertDefinition> = {
  dailySpend: {
    label: "Daily spending",
    title: "Notify me when today reaches",
    current: 52.4,
    unit: "currency",
    step: 10,
    min: 10,
    max: 200,
    condition: (current, threshold) => current >= threshold,
    notification: (current, threshold) =>
      `You've spent R${current.toFixed(2)} today, above your R${threshold.toFixed(2)} limit.`,
    waiting: (current, threshold) => `R${current.toFixed(2)} of R${threshold.toFixed(2)} today.`
  },
  lowBalance: {
    label: "Low balance",
    title: "Notify me when balance drops below",
    current: 186.4,
    unit: "currency",
    step: 50,
    min: 50,
    max: 500,
    condition: (current, threshold) => current <= threshold,
    notification: (current, threshold) =>
      `Your balance is R${current.toFixed(2)}, below your R${threshold.toFixed(2)} alert.`,
    waiting: (current, threshold) => `Balance R${current.toFixed(2)} · alert below R${threshold.toFixed(2)}.`
  },
  runway: {
    label: "Running out soon",
    title: "Notify me when balance may last",
    current: 2.4,
    unit: "days",
    step: 1,
    min: 1,
    max: 10,
    condition: (current, threshold) => current <= threshold,
    notification: (current, threshold) =>
      `At your recent spending rate, your balance may last about ${Math.round(current)} days — inside your ${threshold}-day alert.`,
    waiting: (current, threshold) => `${current.toFixed(1)} days estimated · alert at ${threshold} days.`
  }
};

const order: AlertId[] = ["dailySpend", "lowBalance", "runway"];

function formatThreshold(definition: AlertDefinition, value: number) {
  return definition.unit === "currency" ? `R${value}` : `${value} days`;
}

export function AlertPlayground() {
  const [selectedId, setSelectedId] = useState<AlertId>("dailySpend");
  const [thresholds, setThresholds] = useState<Record<AlertId, number>>({
    dailySpend: 50,
    lowBalance: 200,
    runway: 3
  });
  const definition = alertDefinitions[selectedId];
  const threshold = thresholds[selectedId];
  const triggered = definition.condition(definition.current, threshold);

  function changeThreshold(direction: -1 | 1) {
    setThresholds((current) => ({
      ...current,
      [selectedId]: Math.min(
        definition.max,
        Math.max(definition.min, current[selectedId] + direction * definition.step)
      )
    }));
  }

  return (
    <section aria-labelledby="alert-heading" className="border-y border-line bg-[#edf5f0]">
      <div className="mx-auto max-w-[86rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
        <div className="grid items-start gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brandTeal">
              Alerts + automatic updates
            </p>
            <h2
              id="alert-heading"
              className="mt-4 max-w-md text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl"
            >
              You don’t need to keep checking.
            </h2>
            <p className="mt-4 max-w-md text-base leading-7 text-muted">
              Set a useful boundary. After periodic sync brings in fresh LiveMopay data, NewinMeter can tell you when it
              has been crossed.
            </p>

            <div className="mt-8 flex flex-wrap gap-2" aria-label="Choose an alert type">
              {order.map((id) => (
                <button
                  aria-pressed={selectedId === id}
                  className={`rounded-md border px-3 py-2 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 motion-reduce:transition-none ${
                    selectedId === id
                      ? "border-brandTeal bg-brandTeal text-white"
                      : "border-brandTeal/15 bg-white/70 text-muted hover:border-brandTeal/40 hover:text-ink"
                  }`}
                  key={id}
                  onClick={() => setSelectedId(id)}
                  type="button"
                >
                  {alertDefinitions[id].label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden border border-brandTeal/15 bg-paper shadow-[0_24px_60px_rgba(1,99,113,0.08)]">
            <div className="grid sm:grid-cols-[1fr_1fr]">
              <div className="px-5 py-7 sm:border-r sm:border-line sm:px-7 sm:py-8">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{definition.label} alert</p>
                <p className="mt-5 text-sm text-ink">{definition.title}</p>

                <div className="mt-6 flex items-center justify-between gap-5 border-y border-line py-4">
                  <button
                    aria-label={`Decrease ${definition.label} threshold`}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line text-ink outline-none transition hover:border-brandTeal/40 hover:bg-accentSoft focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none disabled:opacity-40"
                    disabled={threshold <= definition.min}
                    onClick={() => changeThreshold(-1)}
                    type="button"
                  >
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <div className="text-center" aria-live="polite">
                    <p className="text-3xl font-semibold tracking-[-0.04em] text-ink">
                      {formatThreshold(definition, threshold)}
                    </p>
                    <p className="mt-1 text-xs text-muted">Illustrative threshold</p>
                  </div>
                  <button
                    aria-label={`Increase ${definition.label} threshold`}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line text-ink outline-none transition hover:border-brandTeal/40 hover:bg-accentSoft focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none disabled:opacity-40"
                    disabled={threshold >= definition.max}
                    onClick={() => changeThreshold(1)}
                    type="button"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-5 flex items-center gap-2 text-xs text-muted">
                  <span className={`h-2 w-2 rounded-full ${triggered ? "bg-accent" : "bg-line"}`} aria-hidden="true" />
                  {triggered ? "Condition crossed after fresh data arrived" : "Not triggered yet"}
                </div>
              </div>

              <div className="border-t border-line px-5 py-7 sm:border-t-0 sm:px-7 sm:py-8">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Phone notification</p>
                <div
                  className={`mt-5 min-h-40 rounded-xl border px-4 py-4 transition-colors duration-300 motion-reduce:transition-none ${
                    triggered ? "border-accent/35 bg-accentSoft/65" : "border-line bg-canvas"
                  }`}
                  aria-live="polite"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-ink text-brandGreen">
                        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <p className="text-xs font-semibold text-ink">NewinMeter</p>
                    </div>
                    <span className="text-xs text-muted">now</span>
                  </div>
                  <p className="mt-4 text-sm font-semibold text-ink">
                    {triggered ? definition.label : "Not triggered yet"}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-muted">
                    {triggered
                      ? definition.notification(definition.current, threshold)
                      : definition.waiting(definition.current, threshold)}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-2 border-t border-line bg-canvas/60 px-5 py-4 text-xs text-muted sm:grid-cols-[auto_1fr_auto_1fr_auto] sm:items-center sm:px-7">
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                <RefreshCw className="h-3.5 w-3.5 text-brandTeal" aria-hidden="true" />
                Periodic sync
              </span>
              <span className="hidden h-px bg-line sm:block" aria-hidden="true" />
              <span className="inline-flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> Fresh data checked
              </span>
              <span className="hidden h-px bg-line sm:block" aria-hidden="true" />
              <span className={triggered ? "font-medium text-brandTeal" : "text-muted"}>
                {triggered ? "Notification ready" : "Waiting for threshold"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
