import "server-only";

function required(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length) {
      return value;
    }
  }

  throw new Error(`MISSING_ENV: one of ${names.join(", ")} must be set in the environment.`);
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length ? value : fallback;
}

export function getSupabaseUrl() {
  return required("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
}

export function getSupabaseAnonKey() {
  return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
}

export function getSupabaseServiceRoleKey() {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

export function getTokenEncryptionKey(): Buffer {
  const raw = required("NEWINMETER_TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error("NEWINMETER_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key).");
  }

  return key;
}

export function getNewinmeterFirebaseApiKey() {
  return required("NEWINMETER_FIREBASE_API_KEY");
}

export function getNewinmeterWebBaseUrl() {
  return optional("NEWINMETER_WEB_BASE_URL", "https://app.propertywallet.co.za");
}

export function getNewinmeterWebPortalOrigin() {
  return optional("NEWINMETER_WEB_PORTAL_ORIGIN", "https://app.livewalletportal.co.za");
}

export function getNewinmeterWebAppFlavor() {
  return optional("NEWINMETER_WEB_APP_FLAVOR", "livemopay");
}

export function getNewinmeterCanaryConfig() {
  return {
    email: required("NEWINMETER_CANARY_EMAIL"),
    password: required("NEWINMETER_CANARY_PASSWORD"),
    accountId: required("NEWINMETER_CANARY_ACCOUNT_ID")
  };
}

export function getVapidPublicKey() {
  return required("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PUBLIC_KEY");
}

export function getVapidPrivateKey() {
  return required("VAPID_PRIVATE_KEY");
}

export function getVapidSubject() {
  return optional("VAPID_SUBJECT", "mailto:support@newinmeter.app");
}

// Shared secret Vercel Cron sends as `Authorization: Bearer <CRON_SECRET>`.
// The stale-check endpoint rejects any request without it, so the cron route
// can't be triggered by the public internet.
export function getCronSecret() {
  return required("CRON_SECRET");
}

// Shared secret gating the one-click recruiter demo entry point
// (/login?demo=<token> -> /api/demo-login). Server-only -- deliberately not
// a NEXT_PUBLIC_ var. Optional: unset disables the feature entirely (the
// demo button never renders and the endpoint always denies).
export function getNewinmeterDemoAccessToken(): string | undefined {
  const value = process.env.NEWINMETER_DEMO_ACCESS_TOKEN;
  return value && value.length ? value : undefined;
}

// Email of the one seeded demo Supabase Auth user (scripts/seed-demo-account.ts).
// /api/demo-login only ever signs in this one operator-configured address --
// it never accepts an email from the request.
export function getNewinmeterDemoEmail(): string | undefined {
  const value = process.env.NEWINMETER_DEMO_EMAIL;
  return value && value.length ? value : undefined;
}

export function getOpenAiApiKey(): string | undefined {
  const value = process.env.OPENAI_API_KEY;
  return value && value.length ? value : undefined;
}

export function getOpenAiModel() {
  return optional("OPENAI_MODEL", "gpt-5.6-terra");
}

// Reasoning effort for the assistant's Responses API calls -- "low" by
// default (fast, cheap, sufficient for grounded tool-driven Q&A over
// already-computed numbers), overridable per-deployment without a code
// change for a heavier workload.
export function getOpenAiReasoningEffort(): "none" | "minimal" | "low" | "medium" | "high" {
  const value = optional("OPENAI_REASONING_EFFORT", "low");
  return value === "none" || value === "minimal" || value === "low" || value === "medium" || value === "high"
    ? value
    : "low";
}
