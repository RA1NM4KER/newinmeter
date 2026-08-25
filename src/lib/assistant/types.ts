import type { AlertType } from "@/lib/newinmeter/alert-types";
import type { Analytics, DailyRollupRow, DashboardSummary, HourlyRollupRow } from "@/lib/types";

export type AssistantConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantScope = {
  from?: string;
  to?: string;
};

// Deliberately narrower than the full UserPermissions row -- the assistant
// toolbox only needs to know which optional capabilities to register.
export type AssistantPermissions = {
  activitiesEnabled: boolean;
  alertsEnabled: boolean;
};

// Trusted, typed context the UI attaches to a request -- never something the
// model infers from natural language. Currently only used by the "Ask AI"
// affordance on a notification: the alertEventId travels here, not baked
// into the prompt text, so ownership is verified server-side (see
// explain-alert.ts / getAlertEventDetail) regardless of what the user typed.
export type AssistantContext = {
  alertEventId?: string;
};

export type AssistantToolHandler = (
  args: Record<string, unknown>,
  getContext: () => Promise<DashboardContext>
) => Promise<unknown>;

// Flat function-tool shape the Responses API expects (openai npm SDK's
// FunctionTool) -- no `.function` nesting like Chat Completions used.
export type ResponsesFunctionToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
};

export type AssistantTool = {
  definition: ResponsesFunctionToolDefinition;
  handler: AssistantToolHandler;
};

export type DashboardContext = {
  accessToken: string;
  userId: string;
  permissions: AssistantPermissions;
  summary: DashboardSummary;
  dailyRows: DailyRollupRow[];
  hourlyRows: HourlyRollupRow[];
  analytics: Analytics;
  scope: {
    from: string;
    to: string;
  };
};

// ---------------------------------------------------------------------------
// Structured response contract (AI v2) -- see response-schema.ts for the
// zod validator and the matching strict JSON schema handed to the model as
// the submit_response tool. Every field here is app-owned shape; the model
// only ever fills in values, never invents new fields or numbers outside of
// what a tool already returned.
// ---------------------------------------------------------------------------

export type AssistantEvidence =
  | { type: "day"; date: string; label: string }
  | { type: "period"; from: string; to: string; label: string }
  | { type: "activity"; activityId: string; label: string }
  | { type: "alert"; alertEventId: string; label: string }
  | { type: "data_status"; label: string };

// One highlighted window on an hourly chart, with an optional short label
// (e.g. "Evening spike") -- an hourly_usage visualization carries an ARRAY
// of these so one day with two contributing periods (a morning peak and an
// evening peak) renders as one chart with two highlighted ranges, never two
// near-identical full-day charts (see normalizeVisualizations in
// response-schema.ts, which also merges/dedupes same-date hourly_usage
// entries the model might otherwise emit separately).
export type AssistantHighlight = {
  fromHour: number;
  toHour: number;
  label: string | null;
};

// Deterministic product views -- the model chooses WHICH view and what to
// highlight, never the underlying numbers. The client resolves these against
// real NewinMeter data (existing /api/daily-rollups, /api/day-intervals).
export type AssistantVisualization =
  | {
      type: "hourly_usage";
      date: string;
      highlights: AssistantHighlight[];
      title: string | null;
    }
  | {
      type: "daily_usage";
      from: string;
      to: string;
      highlightDate: string | null;
      title: string | null;
    }
  | {
      type: "period_comparison";
      currentFrom: string;
      currentTo: string;
      previousFrom: string;
      previousTo: string;
      title: string | null;
    };

export type AssistantNavigateDestination =
  | { page: "dashboard"; from: string | null; to: string | null }
  | { page: "data"; date: string | null; from: string | null; to: string | null }
  | { page: "activities"; date: string | null };

// Every mutating action carries requiresConfirmation: true (a literal, not a
// boolean) -- the type system itself makes "propose a mutation the UI
// doesn't confirm" unrepresentable, not just a convention. navigate is the
// only action that runs immediately (no server call, no data change).
export type AssistantAction =
  | { type: "navigate"; label: string; destination: AssistantNavigateDestination }
  | {
      type: "add_activity";
      label: string;
      date: string;
      start: string;
      end: string;
      suggestedTags: string[];
      requiresConfirmation: true;
    }
  | {
      type: "set_alert";
      label: string;
      alertType: AlertType;
      threshold: number | null;
      requiresConfirmation: true;
    }
  | {
      type: "update_alert";
      label: string;
      alertType: AlertType;
      threshold: number | null;
      requiresConfirmation: true;
    }
  | {
      type: "disable_alert";
      label: string;
      alertType: AlertType;
      requiresConfirmation: true;
    }
  | { type: "sync"; label: string; requiresConfirmation: true };

// A short, optionally-titled block of explanatory text -- e.g. heading
// "20:00-22:00", text "This was the largest evening spike." Rendered as
// plain structured hierarchy (see assistant-message.tsx), never markdown,
// so the UI controls typography/spacing instead of the model.
export type AssistantBodyBlock = {
  heading: string | null;
  text: string;
};

export type AssistantMetric = {
  label: string;
  value: string;
};

export type AssistantResponse = {
  // A short, scannable conclusion -- "Aug 13 was unusually expensive", not
  // a full paragraph. See system-prompt.ts's RESPONSE SHAPE section.
  headline: string;
  // 0-3 key numbers backing the headline, e.g. { label: "Spend", value:
  // "R84.20" }. Rendered as one compact inline row, not stat cards.
  metrics: AssistantMetric[];
  // 0-3 short explanatory blocks -- the model's only outlet for "why", kept
  // deliberately small so a turn never reads as a wall of prose.
  body: AssistantBodyBlock[];
  evidence: AssistantEvidence[];
  visualizations: AssistantVisualization[];
  actions: AssistantAction[];
  suggestions: string[];
  scope: {
    from: string;
    to: string;
  };
  // Internal/telemetry only -- never rendered to the user (see
  // assistant-message.tsx). Kept for developer debugging and logging.
  toolsUsed: string[];
};
