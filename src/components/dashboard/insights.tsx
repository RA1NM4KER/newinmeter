import { useRef } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { ScrollHint } from "@/components/ui/scroll-hint";
import type { InsightsProps } from "./types";

const toneClass = {
  neutral: "bg-canvas",
  good: "bg-accentSoft",
  watch: "bg-amberSoft"
};

export function Insights({ insights }: InsightsProps) {
  const railRef = useRef<HTMLDivElement>(null);

  return (
    <Card>
      <CardHeader title="Signals" />
      <div className="relative">
        <div
          ref={railRef}
          className="snap-rail flex snap-x gap-3 overflow-x-auto p-4 md:grid md:grid-cols-2 xl:grid-cols-3"
        >
          {insights.map((insight) => (
            <article
              className={`min-w-[16rem] snap-start rounded-lg border border-line p-4 md:min-w-0 ${toneClass[insight.tone ?? "neutral"]}`}
              key={insight.title}
            >
              <h3 className="text-sm font-semibold text-ink">{insight.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{insight.body}</p>
            </article>
          ))}
        </div>
        <ScrollHint containerRef={railRef} />
      </div>
    </Card>
  );
}
