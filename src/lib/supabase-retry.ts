import "server-only";

import { checkRequestBudget } from "./request-budget";

const TRANSIENT_SUPABASE_RETRY_ATTEMPTS = 3;
const TRANSIENT_SUPABASE_RETRY_DELAY_MS = 250;

// A gateway timeout is ambiguous: PostgREST may have completed the statement
// even though the caller did not receive its response. Only use retries for
// operations that are naturally idempotent, or after reconciling their state.
export function isTransientSupabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) ||
    /\b(502|503|504)\b|gateway timeout|fetch failed|network/i.test(message)
  );
}

export async function retryTransientSupabaseOperation<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < TRANSIENT_SUPABASE_RETRY_ATTEMPTS; attempt += 1) {
    checkRequestBudget();
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientSupabaseError(error) || attempt === TRANSIENT_SUPABASE_RETRY_ATTEMPTS - 1) {
        throw error;
      }

      checkRequestBudget();
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_SUPABASE_RETRY_DELAY_MS * 2 ** attempt));
    }
  }

  throw lastError;
}
