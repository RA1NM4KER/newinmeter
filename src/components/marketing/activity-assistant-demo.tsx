"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { formatKwh, formatRand, spendFor, type DemoScenarioId } from "./demo-data";

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

type ActivityAssistantDemoProps = {
  storyScenarioId?: DemoScenarioId;
  storySelectedTime?: string;
};

export function ActivityAssistantDemo({ storyScenarioId, storySelectedTime }: ActivityAssistantDemoProps = {}) {
  const [selectedId, setSelectedId] = useState<ActivityId>("geyser");
  const selected = activities[selectedId];
  const usage = usageFor(selected.start, selected.end);
  const maxValue = Math.max(...values);

  useEffect(() => {
    if (storySelectedTime) {
      setSelectedId(Number(storySelectedTime.split(":")[0]) >= 22 ? "geyser" : "cooking");
    } else if (storyScenarioId === "lateNight") {
      setSelectedId("geyser");
    } else if (storyScenarioId) {
      setSelectedId("cooking");
    }
  }, [storyScenarioId, storySelectedTime]);

  return (
    <section aria-labelledby="activity-heading" className="bg-[#f7f7f3]">
      <div className="mx-auto max-w-[86rem] px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
        <div className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <h2
            id="activity-heading"
            className="max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-5xl"
          >
            You noticed the spike.
            <br />
            Now add context.
          </h2>
          <p className="max-w-md text-base leading-7 text-muted lg:justify-self-end">
            Label what was running, then ask about the same window. NewinMeter shows overlaps without claiming they
            prove the cause.
          </p>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1.12fr_0.88fr] lg:gap-0">
          <div className="min-w-0 lg:pr-14">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <p className="text-sm text-muted">Tuesday · 18:00–00:00</p>
                <p className="mt-2 text-lg font-semibold text-ink">Electricity usage</p>
              </div>
              <p className="text-sm font-medium text-brandTeal">{selected.time} selected</p>
            </div>

            <div className="relative mt-8 h-52 border-b border-ink/20 sm:h-64">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-line" />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 border-x border-brandTeal/20 bg-brandTeal/[0.045] transition-all duration-300 motion-reduce:transition-none"
                style={{
                  left: `${(selected.start / values.length) * 100}%`,
                  width: `${((selected.end - selected.start) / values.length) * 100}%`
                }}
              />
              <div className="absolute inset-0 flex items-end gap-2 sm:gap-3">
                {values.map((value, index) => {
                  const selectedBar = index >= selected.start && index < selected.end;
                  return (
                    <span
                      aria-hidden="true"
                      className={`min-w-0 flex-1 rounded-t-sm transition-[height,background-color,opacity] duration-300 motion-reduce:transition-none ${
                        selectedBar ? "bg-brandTeal" : "bg-accent/35"
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

            <div className="mt-8">
              <p className="text-sm font-medium text-ink">What was happening</p>
              <div className="relative mt-4 h-24 border-y border-ink/15">
                <div className="pointer-events-none absolute left-1/3 top-0 h-full border-l border-line" />
                <div className="pointer-events-none absolute left-2/3 top-0 h-full border-l border-line" />
                <button
                  aria-label="Cooking"
                  aria-pressed={selectedId === "cooking"}
                  className={`absolute left-0 top-3 h-8 w-1/3 rounded-md border px-2 text-left text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none ${
                    selectedId === "cooking"
                      ? "border-brandTeal bg-brandTeal text-white"
                      : "border-accent/30 bg-accentSoft text-ink hover:border-brandTeal/50"
                  }`}
                  onClick={() => setSelectedId("cooking")}
                  type="button"
                >
                  <span className="sm:hidden">Cooking</span>
                  <span className="hidden sm:inline">Cooking · 18:00–20:00</span>
                </button>
                <button
                  aria-label="Geyser"
                  aria-pressed={selectedId === "geyser"}
                  className={`absolute left-2/3 top-[3.25rem] h-8 w-1/3 rounded-md border px-2 text-left text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none ${
                    selectedId === "geyser"
                      ? "border-brandTeal bg-brandTeal text-white"
                      : "border-accent/30 bg-accentSoft text-ink hover:border-brandTeal/50"
                  }`}
                  onClick={() => setSelectedId("geyser")}
                  type="button"
                >
                  <span className="sm:hidden">Geyser</span>
                  <span className="hidden sm:inline">Geyser · 22:00–00:00</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col border-t border-ink/15 pt-10 lg:min-h-[32rem] lg:border-l lg:border-t-0 lg:pl-14 lg:pt-0">
            <p className="text-sm font-semibold text-brandTeal">NewinMeter Assistant</p>
            <div className="mt-7 ml-auto max-w-[88%] rounded-2xl bg-ink px-4 py-2.5 text-sm leading-6 text-paper">
              {selected.question}
            </div>

            <div className="public-demo-answer mt-9">
              <p className="text-xl font-semibold leading-7 text-ink">The highlighted window stands out.</p>
              <p className="mt-3 text-base leading-7 text-muted">{selected.answer}</p>
              <div className="mt-7 flex flex-wrap gap-x-8 gap-y-2 border-y border-ink/15 py-5">
                <p>
                  <strong className="text-2xl font-semibold tracking-tight text-ink">
                    {formatRand(spendFor(usage))}
                  </strong>
                  <span className="ml-2 text-xs text-muted">spend</span>
                </p>
                <p>
                  <strong className="text-2xl font-semibold tracking-tight text-ink">{formatKwh(usage)}</strong>
                  <span className="ml-2 text-xs text-muted">recorded</span>
                </p>
              </div>
              <p className="mt-5 text-xs leading-5 text-muted">
                This period overlaps the Activity labelled {selected.label}. That is context, not proof of cause.
              </p>
            </div>

            <a
              className="group mt-auto inline-flex w-fit items-center gap-2 pt-9 text-sm font-semibold text-ink outline-none hover:text-brandTeal focus-visible:ring-2 focus-visible:ring-accent"
              href="#understand-day"
            >
              Back to Tuesday
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
