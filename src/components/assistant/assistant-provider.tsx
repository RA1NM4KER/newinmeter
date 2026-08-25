"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AssistantConversationMessage,
  AssistantProgressStage,
  AssistantResponse,
  AssistantStreamEvent
} from "@/lib/assistant/types";
import { flattenAssistantResponseText } from "@/lib/assistant/response-text";
import { apiEndpoints } from "@/lib/endpoints";

export type AssistantTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  // Only set on assistant turns -- the full structured contract (evidence,
  // visualizations, actions, suggestions), not just the plain answer text.
  response?: AssistantResponse;
};

export type AssistantOpenOptions = {
  from?: string;
  to?: string;
  alertEventId?: string;
  // Auto-submitted immediately on open, e.g. from "Ask AI" on a
  // notification -- the alertEventId travels as trusted context (see
  // assistant/types.ts), never baked into this question text itself.
  seedQuestion?: string;
};

export type AssistantProgress = { stage: AssistantProgressStage; label: string };

type AssistantState = {
  isOpen: boolean;
  isPending: boolean;
  // Real execution progress for the in-flight turn only -- reset to null on
  // every new question and once a final answer/error lands. Never
  // persisted into turns/history (see submit() below: only the "response"
  // event's payload is ever appended to turns).
  progress: AssistantProgress | null;
  error: string;
  turns: AssistantTurn[];
  scope: { from: string; to: string };
  isEnabled: boolean;
  isActivitiesEnabled: boolean;
  isAlertsEnabled: boolean;
  isDemo: boolean;
  open: (options?: AssistantOpenOptions) => void;
  close: () => void;
  ask: (question: string) => void;
  clearError: () => void;
};

const AssistantContext = createContext<AssistantState | null>(null);

let turnIdCounter = 0;
function nextTurnId() {
  turnIdCounter += 1;
  return `turn-${turnIdCounter}`;
}

// Parses one growing SSE text buffer into complete `data: <json>\n\n`
// frames as they arrive, returning the parsed events found so far and
// whatever incomplete tail is left to prepend to the next chunk.
function extractSseEvents(buffer: string): { events: AssistantStreamEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: AssistantStreamEvent[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed.replace(/^data:\s*/, "")) as AssistantStreamEvent);
    } catch {
      // A malformed frame is dropped rather than crashing the whole
      // stream -- the final "response" event (or its absence, surfaced as
      // a request-level error below) is what actually matters.
    }
  }
  return { events, rest };
}

export function AssistantProvider({
  isEnabled,
  isActivitiesEnabled = false,
  isAlertsEnabled = false,
  isDemo = false,
  children
}: {
  isEnabled: boolean;
  isActivitiesEnabled?: boolean;
  isAlertsEnabled?: boolean;
  isDemo?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [progress, setProgress] = useState<AssistantProgress | null>(null);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [scope, setScope] = useState({ from: "", to: "" });
  // Trusted context for the NEXT request only -- e.g. an alertEventId from
  // "Ask AI". Cleared after the first question in a session so it never
  // silently reattaches to an unrelated later question.
  const pendingAlertEventIdRef = useRef<string | undefined>(undefined);
  // The in-flight request's own controller, so close()/unmount can cancel
  // it -- a stream left running after the user navigated away would just
  // waste the upstream call and risk a stray late state update.
  const abortControllerRef = useRef<AbortController | null>(null);

  const submit = useCallback(
    (question: string, history: AssistantTurn[]) => {
      const trimmed = question.trim();
      if (!trimmed || isPending) {
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setError("");
      setProgress(null);
      const userTurn: AssistantTurn = { id: nextTurnId(), role: "user", content: trimmed };
      setTurns((current) => [...current, userTurn]);
      setIsPending(true);

      const alertEventId = pendingAlertEventIdRef.current;
      pendingAlertEventIdRef.current = undefined;

      const conversationHistory: AssistantConversationMessage[] = history
        .slice(-8)
        .map((turn) => ({ role: turn.role, content: turn.content }));

      (async () => {
        try {
          const result = await fetch(apiEndpoints.assistant, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              question: trimmed,
              from: scope.from || undefined,
              to: scope.to || undefined,
              history: conversationHistory,
              context: alertEventId ? { alertEventId } : undefined
            })
          });

          if (!result.ok || !result.body) {
            const responseBody = await result.json().catch(() => ({ message: "Assistant request failed." }));
            if (controller.signal.aborted) return;
            setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
            setError(responseBody.message || "Assistant request failed.");
            return;
          }

          const reader = result.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let settled = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const { events, rest } = extractSseEvents(buffer);
            buffer = rest;

            for (const event of events) {
              if (controller.signal.aborted) return;
              if (event.type === "progress") {
                setProgress({ stage: event.stage, label: event.label });
              } else if (event.type === "response") {
                settled = true;
                setProgress(null);
                setTurns((current) => [
                  ...current,
                  {
                    id: nextTurnId(),
                    role: "assistant",
                    content: flattenAssistantResponseText(event.response),
                    response: event.response
                  }
                ]);
                if (event.response.scope.from && event.response.scope.to) {
                  setScope(event.response.scope);
                }
              } else if (event.type === "error") {
                settled = true;
                setProgress(null);
                setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
                setError(event.message);
              }
            }
          }

          if (!settled && !controller.signal.aborted) {
            setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
            setError("Assistant request failed.");
          }
        } catch (requestError) {
          if (controller.signal.aborted || (requestError instanceof DOMException && requestError.name === "AbortError")) {
            return;
          }
          setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
          setError(requestError instanceof Error ? requestError.message : "Assistant request failed.");
        } finally {
          if (!controller.signal.aborted) {
            setIsPending(false);
            setProgress(null);
          }
          if (abortControllerRef.current === controller) {
            abortControllerRef.current = null;
          }
        }
      })();
    },
    [isPending, scope]
  );

  const open = useCallback(
    (options: AssistantOpenOptions = {}) => {
      setIsOpen(true);
      setError("");
      if (options.from !== undefined || options.to !== undefined) {
        setScope({ from: options.from ?? "", to: options.to ?? "" });
      }
      if (options.alertEventId) {
        pendingAlertEventIdRef.current = options.alertEventId;
      }
      if (options.seedQuestion) {
        // Read current turns via a functional update so `open` doesn't need
        // `turns` in its own dependency array (it would otherwise change
        // identity on every turn and defeat memoized trigger buttons).
        setTurns((current) => {
          submit(options.seedQuestion as string, current);
          return current;
        });
      }
    },
    [submit]
  );

  const close = useCallback(() => {
    setIsOpen(false);
    // Cancel any in-flight request -- no point letting it finish once the
    // dialog is closed, and this guarantees isPending can't get stuck if
    // the user reopens and asks something new right away.
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsPending(false);
    setProgress(null);
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const clearError = useCallback(() => setError(""), []);
  const ask = useCallback((question: string) => submit(question, turns), [submit, turns]);

  const value = useMemo<AssistantState>(
    () => ({
      isOpen,
      isPending,
      progress,
      error,
      turns,
      scope,
      isEnabled,
      isActivitiesEnabled,
      isAlertsEnabled,
      isDemo,
      open,
      close,
      ask,
      clearError
    }),
    [
      isOpen,
      isPending,
      progress,
      error,
      turns,
      scope,
      isEnabled,
      isActivitiesEnabled,
      isAlertsEnabled,
      isDemo,
      open,
      close,
      ask,
      clearError
    ]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantState {
  const context = useContext(AssistantContext);
  if (!context) {
    throw new Error("useAssistant must be used within an AssistantProvider");
  }
  return context;
}
