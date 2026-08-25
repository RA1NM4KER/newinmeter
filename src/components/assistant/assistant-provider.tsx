"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { AssistantConversationMessage, AssistantResponse } from "@/lib/assistant/types";
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

type AssistantState = {
  isOpen: boolean;
  isPending: boolean;
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
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [scope, setScope] = useState({ from: "", to: "" });
  // Trusted context for the NEXT request only -- e.g. an alertEventId from
  // "Ask AI". Cleared after the first question in a session so it never
  // silently reattaches to an unrelated later question.
  const pendingAlertEventIdRef = useRef<string | undefined>(undefined);

  const submit = useCallback(
    (question: string, history: AssistantTurn[]) => {
      const trimmed = question.trim();
      if (!trimmed || isPending) {
        return;
      }

      setError("");
      const userTurn: AssistantTurn = { id: nextTurnId(), role: "user", content: trimmed };
      setTurns((current) => [...current, userTurn]);
      setIsPending(true);

      const alertEventId = pendingAlertEventIdRef.current;
      pendingAlertEventIdRef.current = undefined;

      const conversationHistory: AssistantConversationMessage[] = history
        .slice(-8)
        .map((turn) => ({ role: turn.role, content: turn.content }));

      fetch(apiEndpoints.assistant, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          from: scope.from || undefined,
          to: scope.to || undefined,
          history: conversationHistory,
          context: alertEventId ? { alertEventId } : undefined
        })
      })
        .then(async (result) => {
          if (!result.ok) {
            const body = await result.json().catch(() => ({ message: "Assistant request failed." }));
            setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
            setError(body.message || "Assistant request failed.");
            return;
          }
          const payload = (await result.json()) as AssistantResponse;
          setTurns((current) => [
            ...current,
            { id: nextTurnId(), role: "assistant", content: flattenAssistantResponseText(payload), response: payload }
          ]);
          if (payload.scope.from && payload.scope.to) {
            setScope(payload.scope);
          }
        })
        .catch((requestError) => {
          setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
          setError(requestError instanceof Error ? requestError.message : "Assistant request failed.");
        })
        .finally(() => setIsPending(false));
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

  const close = useCallback(() => setIsOpen(false), []);
  const clearError = useCallback(() => setError(""), []);
  const ask = useCallback((question: string) => submit(question, turns), [submit, turns]);

  const value = useMemo<AssistantState>(
    () => ({
      isOpen,
      isPending,
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
