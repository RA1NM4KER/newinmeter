import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

type Budget = { deadlineAt: number; signal: AbortSignal; requestTimeoutMs: number };
const budgets = new AsyncLocalStorage<Budget>();

// Request-local only: concurrent accounts cannot share or overwrite deadlines.
// Nested work inherits the parent ceiling. Leaving a work scope restores the
// parent's remaining time, allowing bounded failure cleanup after work expires.
export async function withRequestBudget<T>(
  timeoutMs: number,
  operation: () => Promise<T>,
  requestTimeoutMs = 20_000
): Promise<T> {
  const parent = budgets.getStore();
  const deadlineAt = Math.min(Date.now() + timeoutMs, parent?.deadlineAt ?? Infinity);
  const remaining = Math.max(1, deadlineAt - Date.now());
  if (deadlineAt <= Date.now()) throw new DOMException("Request budget exhausted.", "TimeoutError");
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request budget exhausted.", "TimeoutError")),
    remaining
  );
  timer.unref?.();
  const signal = parent ? AbortSignal.any([parent.signal, controller.signal]) : controller.signal;
  try {
    signal.throwIfAborted();
    return await budgets.run({ deadlineAt, signal, requestTimeoutMs }, operation);
  } finally {
    clearTimeout(timer);
  }
}

export function checkRequestBudget() {
  const budget = budgets.getStore();
  if (!budget) return;
  budget.signal.throwIfAborted();
  if (Date.now() >= budget.deadlineAt) throw new DOMException("Request budget exhausted.", "TimeoutError");
}

// Native HTTP clients (for example web-push) accept a timeout instead of an
// AbortSignal. Keep those requests inside the same invocation ceiling too.
export function currentRequestTimeoutMs(): number | undefined {
  const budget = budgets.getStore();
  if (!budget) return undefined;
  checkRequestBudget();
  return Math.max(1, Math.min(budget.requestTimeoutMs, budget.deadlineAt - Date.now()));
}

export function fetchWithRequestBudget(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const budget = budgets.getStore();
  if (!budget) return fetch(input, init);
  checkRequestBudget();
  return fetch(input, {
    ...init,
    signal: AbortSignal.any([
      budget.signal,
      AbortSignal.timeout(currentRequestTimeoutMs()!),
      ...(init?.signal ? [init.signal] : [])
    ])
  });
}
