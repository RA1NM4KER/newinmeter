import "server-only";

// Minimal structured, low-noise logging for the Live subsystem, following the
// repo's console.error convention but emitting one greppable JSON line with a
// stable event category plus safe identifiers. Every message is passed through
// redact() first, because Supabase/PostgREST error strings can embed the
// request URL -- which for the device-auth query contains the device's
// api_key_hash. We never want a hash, a raw key, or a bearer token in logs.

type LogFields = Record<string, string | number | boolean | null | undefined>;

// Strip anything secret from a free-text message before it is logged.
export function redact(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/nm_dev_[A-Za-z0-9_-]+/g, "nm_dev_<redacted>")
    .replace(/\b(api_key_hash|apikey|access_token|refresh_token)=(eq\.)?[^&\s"']+/gi, "$1=<redacted>")
    .replace(/\b[a-f0-9]{32,}\b/gi, "<redacted>");
}

function emit(level: "error" | "warn", category: string, fields: LogFields): void {
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      safe[key] = typeof value === "string" ? redact(value) : value;
    }
  }
  const line = JSON.stringify({ evt: category, ...safe });
  if (level === "error") {
    console.error(line);
  } else {
    console.warn(line);
  }
}

// A categorized error line. `error` is reduced to a redacted message string --
// never the full object, stack, or anything secret.
export function logLiveError(category: string, error: unknown, fields: LogFields = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  emit("error", category, { ...fields, error: redact(message) });
}

// A categorized warning for expected-but-notable conditions (e.g. a best-effort
// broadcast that didn't land). Lower severity than an error.
export function logLiveWarning(category: string, fields: LogFields = {}): void {
  emit("warn", category, fields);
}
