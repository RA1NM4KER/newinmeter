"use client";

import { ArrowUp, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FullscreenDialog } from "@/components/ui/fullscreen-dialog";
import { AssistantMessage } from "./assistant-message";
import { useAssistant } from "./assistant-provider";

function buildStarterQuestions(isActivitiesEnabled: boolean, isAlertsEnabled: boolean) {
  const starters = [
    "What stands out in my usage?",
    "Why was my latest expensive day so high?",
    "How long will my balance last?"
  ];
  if (isAlertsEnabled) {
    starters.push("Which alerts would be useful for me?");
  } else if (isActivitiesEnabled) {
    starters.push("What activities use the most electricity?");
  } else {
    starters.push("Compare this period to the previous one.");
  }
  return starters;
}

export function AssistantDialog() {
  const { isOpen, close, turns, isPending, error, ask, isActivitiesEnabled, isAlertsEnabled, clearError } =
    useAssistant();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, isPending]);

  function submit(question: string) {
    if (!question.trim()) return;
    clearError();
    ask(question);
    setDraft("");
  }

  return (
    <FullscreenDialog
      closeIcon={X}
      closeLabel="Close assistant"
      contentClassName="h-full"
      eyebrow="Assistant"
      isOpen={isOpen}
      onClose={close}
      panelClassName="max-w-4xl"
      title="Ask your data"
    >
      <div className="flex h-full flex-col rounded-lg border border-line bg-paper shadow-soft">
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 py-5 sm:px-6" ref={scrollRef}>
          {turns.length ? (
            turns.map((turn) => <AssistantMessage key={turn.id} onSuggestion={submit} turn={turn} />)
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-10 text-center">
              <p className="text-sm font-medium text-ink">Ask about your usage, spend, or balance.</p>
              <p className="max-w-sm text-[0.8125rem] text-muted">
                I&apos;ll answer using your real NewinMeter data, with the numbers and charts to back it up.
              </p>
            </div>
          )}

          {isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking...
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>
          ) : null}
        </div>

        <div className="border-t border-line px-4 py-4 sm:px-6">
          {turns.length === 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {buildStarterQuestions(isActivitiesEnabled, isAlertsEnabled).map((starter) => (
                <button
                  className="rounded-full border border-line bg-canvas px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink"
                  key={starter}
                  onClick={() => submit(starter)}
                  type="button"
                >
                  {starter}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Ask the NewinMeter assistant</span>
              <input
                className="h-11 w-full rounded-md border border-line bg-paper px-4 text-sm text-ink outline-none transition focus:border-accent"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit(draft);
                  }
                }}
                placeholder={
                  turns.length ? "Ask a follow-up..." : "Ask about spend, usage, top-ups, spikes, or comparisons..."
                }
                value={draft}
              />
            </label>
            <button
              aria-label="Ask"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isPending || !draft.trim()}
              onClick={() => submit(draft)}
              title="Ask"
              type="button"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
    </FullscreenDialog>
  );
}
