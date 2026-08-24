import type { AssistantTurn } from "./assistant-provider";
import { AssistantActionRow } from "./assistant-action-row";
import { AssistantVisualizationCard } from "./assistant-visualization";
import { EvidenceRow } from "./evidence-chip";

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

  return (
    <div className="flex max-w-[92%] flex-col gap-3">
      <p className="whitespace-pre-wrap text-[0.9375rem] leading-6 text-ink">{turn.content}</p>

      {response?.evidence.length ? <EvidenceRow evidence={response.evidence} /> : null}

      {response?.visualizations.length ? (
        <div className="flex flex-col gap-2">
          {response.visualizations.map((visualization, index) => (
            <AssistantVisualizationCard key={`${visualization.type}-${index}`} visualization={visualization} />
          ))}
        </div>
      ) : null}

      {response?.actions.length ? <AssistantActionRow actions={response.actions} /> : null}

      {response?.suggestions.length ? (
        <div className="flex flex-wrap gap-1.5">
          {response.suggestions.map((suggestion) => (
            <button
              className="rounded-full border border-line bg-canvas px-3 py-1 text-xs text-muted transition hover:border-accent hover:text-ink"
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
