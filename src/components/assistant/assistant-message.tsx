import type { AssistantTurn } from "./assistant-provider";
import { AssistantActionRow } from "./assistant-action-row";
import { AssistantVisualizationCard } from "./assistant-visualization";
import { EvidenceRow } from "./evidence-chip";

const MAX_VISIBLE_SUGGESTIONS = 2;

export function AssistantMessage({
  turn,
  onSuggestion
}: {
  turn: AssistantTurn;
  onSuggestion: (question: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl bg-ink px-4 py-2.5 text-sm leading-6 text-paper">
        <p className="whitespace-pre-wrap">{turn.content}</p>
      </div>
    );
  }

  const response = turn.response;
  if (!response) {
    return null;
  }

  const suggestions = response.suggestions.slice(0, MAX_VISIBLE_SUGGESTIONS);

  return (
    <div className="flex max-w-full flex-col gap-3 sm:max-w-[34rem]">
      {/* Headline + metrics + body -- the actual answer, weighted heaviest.
          No box, no border: it's the primary content of the turn, not a
          card competing with everything below it. */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[0.9375rem] font-semibold leading-snug text-ink sm:text-base">{response.headline}</p>

        {response.metrics.length ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {response.metrics.map((metric, index) => (
              <span className="inline-flex items-baseline gap-1" key={`${metric.label}-${index}`}>
                {index > 0 ? <span className="mr-1 text-muted/40">·</span> : null}
                <span className="text-sm font-semibold text-ink">{metric.value}</span>
                <span className="text-[0.75rem] text-muted">{metric.label}</span>
              </span>
            ))}
          </p>
        ) : null}

        {response.body.length ? (
          <div className="mt-1 flex flex-col gap-2">
            {response.body.map((block, index) => (
              <div key={index}>
                {block.heading ? (
                  <p className="text-[0.75rem] font-semibold text-ink/60">{block.heading}</p>
                ) : null}
                <p className="text-[0.875rem] leading-relaxed text-muted">{block.text}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {response.visualizations.length ? (
        <div className="flex flex-col gap-2">
          {response.visualizations.map((visualization, index) => (
            <AssistantVisualizationCard key={`${visualization.type}-${index}`} visualization={visualization} />
          ))}
        </div>
      ) : null}

      {response.actions.length ? <AssistantActionRow actions={response.actions} /> : null}

      <EvidenceRow evidence={response.evidence} />

      {suggestions.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5">
          <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted/60">Explore next</span>
          {suggestions.map((suggestion) => (
            <button
              className="text-[0.8125rem] text-muted underline decoration-line decoration-1 underline-offset-4 transition hover:text-ink hover:decoration-accent"
              key={suggestion}
              onClick={() => onSuggestion(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
