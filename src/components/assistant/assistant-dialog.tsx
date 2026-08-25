"use client";

import { ArrowUp, Loader2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FullscreenDialog } from "@/components/ui/fullscreen-dialog";
import { AssistantMessage } from "./assistant-message";
import { AssistantProgressIndicator } from "./assistant-progress-indicator";
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

function DialogTitle() {
  return (
    <span className="flex items-center gap-1.5">
      <Sparkles aria-hidden="true" className="h-4 w-4 text-brandGreen" />
      NewinMeter Assistant
    </span>
  );
}

export function AssistantDialog() {
  const { isOpen, close, turns, isPending, progress, error, ask, isActivitiesEnabled, isAlertsEnabled, clearError } =
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
      bodyClassName="flex min-h-0 flex-1 flex-col"
      closeIcon={X}
      closeLabel="Close assistant"
      contentClassName="flex min-h-0 flex-1 flex-col"
      isOpen={isOpen}
      onClose={close}
      panelClassName="min-h-0 w-full max-w-[820px]"
      title={<DialogTitle />}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8" ref={scrollRef}>
        {turns.length ? (
          <div className="flex flex-col gap-6">
            {turns.map((turn) => (
              <AssistantMessage key={turn.id} onSuggestion={submit} turn={turn} />
            ))}

            {isPending ? <AssistantProgressIndicator label={progress?.label ?? null} /> : null}

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <div>
              <p className="text-lg font-semibold text-ink">Ask NewinMeter</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                Understand what changed, why it changed, and what you can do about it.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {buildStarterQuestions(isActivitiesEnabled, isAlertsEnabled).map((starter) => (
                <button
                  className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink"
                  key={starter}
                  onClick={() => submit(starter)}
                  type="button"
                >
                  {starter}
                </button>
              ))}
            </div>
            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line/60 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 sm:px-8">
        <div className="flex items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Ask the NewinMeter assistant</span>
            <input
              className="h-11 w-full rounded-full border border-line bg-canvas px-4 text-sm text-ink outline-none transition focus:border-accent focus:bg-paper"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(draft);
                }
              }}
              placeholder={turns.length ? "Ask a follow-up..." : "Ask about spend, usage, top-ups, spikes..."}
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
    </FullscreenDialog>
  );
}
