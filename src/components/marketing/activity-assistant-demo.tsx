"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { formatKwh, formatRand, spendFor } from "./demo-data";

type ActivityId = "cooking" | "geyser";

const values = [0.38, 0.62, 0.91, 0.7, 0.35, 0.24, 0.2, 0.22, 0.88, 1.46, 0.96, 0.39];

const activities: Record<
  ActivityId,
  { label: string; time: string; start: number; end: number; answer: string; question: string }
> = {
  cooking: {
    label: "Cooking",
    time: "18:00–20:00",
    start: 0,
    end: 4,
    question: "What happened around dinner?",
    answer:
      "Usage rose between 18:00 and 20:00. That window overlaps your Cooking Activity and stayed below the later 22:30 spike."
  },
  geyser: {
    label: "Geyser",
    time: "22:00–00:00",
    start: 8,
    end: 12,
    question: "Why was last night expensive?",
    answer:
      "Most of the late-night electricity spend happened after 22:00. The largest spike overlaps your Geyser Activity."
  }
};

function usageFor(start: number, end: number) {
  return values.slice(start, end).reduce((total, value) => total + value, 0);
}

export function ActivityAssistantDemo() {
  const [selectedId, setSelectedId] = useState<ActivityId>("geyser");
  const selected = activities[selectedId];
  const usage = usageFor(selected.start, selected.end);
  const maxValue = Math.max(...values);

  return (
    <section aria-labelledby="activity-heading" className="bg-[#f7f7f3]">
      <div className="mx-auto max-w-[86rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brandTeal">Activities + Assistant</p>
            <h2
              id="activity-heading"
              className="mt-4 max-w-2xl text-3xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl"
            >
              Label what was happening. Ask what changed.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-6 text-muted">
            Activities add household context. NewinMeter shows overlaps without pretending they prove the cause.
          </p>
        </div>

        <div className="mt-10 border-y border-ink/15 bg-paper lg:grid lg:grid-cols-[1.08fr_0.92fr]">
          <div className="min-w-0 px-4 py-7 sm:px-7 sm:py-8 lg:border-r lg:border-ink/15">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted">Tuesday night</p>
                <p className="mt-2 text-lg font-semibold text-ink">Electricity usage</p>
              </div>
              <p className="text-xs text-muted">18:00–00:00</p>
            </div>

            <div className="relative mt-8 h-48 border-b border-line sm:h-56">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line" />
              <div className="absolute inset-0 flex items-end gap-2 sm:gap-3">
                {values.map((value, index) => {
                  const selectedBar = index >= selected.start && index < selected.end;
                  return (
                    <span
                      aria-hidden="true"
                      className={`min-w-0 flex-1 rounded-t-sm transition-[height,background-color,opacity] duration-300 motion-reduce:transition-none ${
                        selectedBar ? "bg-brandTeal" : "bg-accent/40"
                      }`}
                      key={`${index}-${value}`}
                      style={{ height: `${Math.max(7, (value / maxValue) * 100)}%` }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span>18:00</span>
              <span>20:00</span>
              <span>22:00</span>
              <span>00:00</span>
            </div>

            <div className="mt-7">
              <p className="text-xs font-medium uppercase tracking-[0.15em] text-muted">Activity timeline</p>
              <div className="relative mt-4 h-20 border-y border-line">
                <div className="pointer-events-none absolute left-1/3 top-0 h-full border-l border-line" />
                <div className="pointer-events-none absolute left-2/3 top-0 h-full border-l border-line" />
                <button
                  aria-pressed={selectedId === "cooking"}
                  className={`absolute left-0 top-2 h-7 w-1/3 rounded-md border px-2 text-left text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none ${
                    selectedId === "cooking"
                      ? "border-brandTeal bg-brandTeal text-white"
                      : "border-accent/30 bg-accentSoft text-ink hover:border-brandTeal/50"
                  }`}
                  onClick={() => setSelectedId("cooking")}
                  type="button"
                >
                  Cooking
                </button>
                <button
                  aria-pressed={selectedId === "geyser"}
                  className={`absolute left-2/3 top-11 h-7 w-1/3 rounded-md border px-2 text-left text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none ${
                    selectedId === "geyser"
                      ? "border-brandTeal bg-brandTeal text-white"
                      : "border-accent/30 bg-accentSoft text-ink hover:border-brandTeal/50"
                  }`}
                  onClick={() => setSelectedId("geyser")}
                  type="button"
                >
                  Geyser →
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col px-4 py-7 sm:px-7 sm:py-8 lg:min-h-[30rem]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brandTeal">Ask NewinMeter</p>
            <div className="mt-8 ml-auto max-w-[86%] rounded-2xl bg-ink px-4 py-2.5 text-sm leading-6 text-paper">
              {selected.question}
            </div>

            <div className="public-demo-answer mt-8">
              <p className="text-base font-semibold leading-6 text-ink">The highlighted window stands out.</p>
              <p className="mt-2 text-sm leading-6 text-muted">{selected.answer}</p>
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-y border-line py-4">
                <p>
                  <strong className="text-lg font-semibold text-ink">{formatRand(spendFor(usage))}</strong>
                  <span className="ml-2 text-xs text-muted">spend</span>
                </p>
                <p>
                  <strong className="text-lg font-semibold text-ink">{formatKwh(usage)}</strong>
                  <span className="ml-2 text-xs text-muted">recorded</span>
                </p>
              </div>
              <p className="mt-4 text-xs leading-5 text-muted">
                This period overlaps the Activity labelled {selected.label}. That is context, not proof of cause.
              </p>
            </div>

            <a
              className="group mt-auto inline-flex w-fit items-center gap-2 pt-8 text-sm font-semibold text-ink outline-none hover:text-brandTeal focus-visible:ring-2 focus-visible:ring-accent"
              href="#understand-day"
            >
              View the day
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
