"use client";

import { ArrowUpRight, Loader2, Sparkles, X } from "lucide-react";
import { useState, useTransition } from "react";
import { FullscreenDialog } from "@/components/ui/fullscreen-dialog";
import type { AssistantConversationMessage, AssistantResponse } from "@/lib/assistant/types";
import { BorderBeam } from "@/components/ui/border-beam";
import { apiEndpoints } from "@/lib/endpoints";

type AssistantPanelProps = {
  from: string;
  to: string;
  compact?: boolean;
};

const starterQuestions = [
  "What stands out most in this date range?",
  "Compare this period to the previous one.",
  "Which days drove the most spend and why?",
  "Are there any unusual spikes or balance patterns?"
];

export function AssistantPanel({ from, to, compact = false }: AssistantPanelProps) {
  const [dialogQuestion, setDialogQuestion] = useState("");
  const [conversation, setConversation] = useState<AssistantConversationMessage[]>([]);
  const [lastResponse, setLastResponse] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submitQuestion = (value: string) => {
    const nextQuestion = value.trim();

    if (!nextQuestion || isPending) {
      return;
    }

    setError("");
    const nextHistory = conversation.slice(-8);
    setConversation((current) => [...current, { role: "user", content: nextQuestion }]);
    setDialogQuestion("");
    setIsOpen(true);

    startTransition(async () => {
      try {
        const result = await fetch(apiEndpoints.assistant, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            question: nextQuestion,
            from,
            to,
            history: nextHistory
          })
        });

        if (!result.ok) {
          const body = await result.json().catch(() => ({ message: "Assistant request failed." }));
          setLastResponse(null);
          setConversation((current) => current.slice(0, Math.max(0, current.length - 1)));
          setError(body.message || "Assistant request failed.");
          return;
        }

        const payload = (await result.json()) as AssistantResponse;
        setLastResponse(payload);
        setConversation((current) => [...current, { role: "assistant", content: payload.answer }]);
      } catch (requestError) {
        setLastResponse(null);
        setConversation((current) => current.slice(0, Math.max(0, current.length - 1)));
        setError(requestError instanceof Error ? requestError.message : "Assistant request failed.");
      }
    });
  };

  return (
    <>
      <button
        className={`group relative overflow-hidden bg-transparent text-left transition duration-200 ${
          compact ? "h-9 w-full rounded-md px-3" : "block w-full rounded-xl px-4 py-3 lg:max-w-3xl"
        }`}
        onClick={() => {
          setIsOpen(true);
          setDialogQuestion("");
        }}
        type="button"
      >
        <div
          className={
            compact
              ? "absolute inset-0 rounded-[inherit] border border-white/15 bg-white/10 transition duration-200 group-hover:border-white/30 group-hover:bg-white/15"
              : "absolute inset-0 rounded-[inherit] border border-line bg-paper transition duration-200 group-hover:border-accent/35 group-hover:bg-canvas/40"
          }
        />
        <BorderBeam
          borderWidth={1.5}
          colorFrom="rgba(0, 255, 155, 0)"
          colorTo="rgba(0, 255, 155, 0.95)"
          duration={8.5}
          size={300}
        />
        <div
          className={`relative flex items-center ${compact ? "text-white/80" : "text-muted"} ${compact ? "gap-2 text-sm" : "gap-3 text-sm"}`}
        >
          <div
            className={`shrink-0 rounded-full ring-1 transition ${
              compact
                ? "bg-white/15 ring-white/20 group-hover:ring-white/35"
                : "bg-paper/90 ring-accent/15 group-hover:ring-accent/30"
            } ${compact ? "flex h-5 w-5 items-center justify-center" : "flex h-8 w-8 items-center justify-center"}`}
          >
            <Sparkles className={`${compact ? "h-3 w-3" : "h-4 w-4"} text-brandGreen`} />
          </div>
          <span
            className={`min-w-0 flex-1 truncate ${compact ? "text-white/80" : "text-ink/80"} ${compact ? "pr-2 text-sm" : ""}`}
          >
            {compact
              ? "Ask your energy assistant..."
              : conversation.length
                ? "Continue the conversation about your usage and spend..."
                : "Ask about spend, usage, top-ups, spikes, or comparisons..."}
          </span>
          {compact ? <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0 text-white/70" /> : null}
        </div>
      </button>

      <FullscreenDialog
        closeIcon={X}
        closeLabel="Close assistant"
        contentClassName="h-full"
        eyebrow="Assistant"
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        panelClassName="max-w-4xl"
        title="Ask your data"
      >
        <div className="flex h-full flex-col rounded-lg border border-line bg-paper shadow-soft">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-4 sm:px-5">
            {conversation.length ? (
              conversation.map((message, index) => (
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                    message.role === "user" ? "ml-auto bg-ink text-paper" : "border border-line bg-canvas/70 text-ink"
                  }`}
                  key={`${message.role}-${index}-${message.content.slice(0, 24)}`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.role === "assistant" &&
                  index === conversation.length - 1 &&
                  lastResponse?.toolsUsed.length ? (
                    <p className="mt-3 text-xs text-muted">Used: {lastResponse.toolsUsed.join(", ")}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-line px-4 py-4 text-sm text-muted">
                Ask a question and then keep the thread going with follow-ups.
              </div>
            )}

            {isPending ? (
              <div className="flex max-w-[88%] items-center gap-2 rounded-2xl border border-line bg-canvas/70 px-4 py-3 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking...
              </div>
            ) : null}

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">{error}</p>
            ) : null}
          </div>

          <div className="border-t border-line px-4 py-4 sm:px-5">
            {conversation.length === 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {starterQuestions.map((starter) => (
                  <button
                    className="rounded-full border border-line bg-canvas px-3 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink"
                    key={starter}
                    onClick={() => submitQuestion(starter)}
                    type="button"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex-1">
                <span className="sr-only">Ask the NewinMeter assistant</span>
                <input
                  className="h-11 w-full rounded-md border border-line bg-paper px-4 text-sm text-ink outline-none transition focus:border-accent"
                  value={dialogQuestion}
                  onChange={(event) => setDialogQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitQuestion(dialogQuestion);
                    }
                  }}
                  placeholder={
                    conversation.length
                      ? "Ask a follow-up..."
                      : "Ask about spend, usage, top-ups, spikes, or comparisons..."
                  }
                />
              </label>
              <button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isPending || !dialogQuestion.trim()}
                onClick={() => submitQuestion(dialogQuestion)}
                type="button"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Ask
              </button>
            </div>
          </div>
        </div>
      </FullscreenDialog>
    </>
  );
}
