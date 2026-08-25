import type { AssistantProgressStage } from "./types";

// The ONLY place a raw tool name ever gets translated into something a user
// sees. Every tool the assistant can call maps to one calm, high-level
// status line -- never the literal function name, its arguments, or any
// reasoning content. See openai.ts's onProgress callback (fired right
// before a batch of real tool calls executes) and /api/assistant's SSE
// writer.
const TOOL_PROGRESS: Record<string, { stage: AssistantProgressStage; label: string }> = {
  get_scope_overview: { stage: "usage", label: "Checking your usage…" },
  get_balance_runout: { stage: "balance", label: "Estimating your remaining balance…" },
  compare_previous_period: { stage: "comparison", label: "Comparing with the previous period…" },
  compare_calendar_months: { stage: "comparison", label: "Comparing months…" },
  get_top_days: { stage: "usage", label: "Finding your highest days…" },
  get_top_hours: { stage: "usage", label: "Finding the busiest times…" },
  explain_day: { stage: "day", label: "Looking at that day…" },
  inspect_time_window: { stage: "time_window", label: "Checking that time window…" },
  get_recent_topups: { stage: "usage", label: "Checking recent top-ups…" },
  get_water_overview: { stage: "water", label: "Checking water usage…" },
  get_data_status: { stage: "data_status", label: "Checking data freshness…" },
  get_activity_report: { stage: "activities", label: "Checking your activities…" },
  find_activities: { stage: "activities", label: "Finding matching activities…" },
  get_alert_status: { stage: "alerts", label: "Reviewing your alerts…" },
  get_recent_alerts: { stage: "alerts", label: "Checking recent alerts…" },
  explain_alert: { stage: "alerts", label: "Looking into that alert…" },
  get_alert_recommendations: { stage: "alerts", label: "Finding useful alerts…" }
};

const FALLBACK_PROGRESS = { stage: "working" as const, label: "Working on it…" };

// Several independent read tools can be called in the same turn (see
// tools/index.ts's Promise.all). Rather than flicker between statuses
// every few dozen milliseconds, one representative stage is chosen for the
// whole batch -- the first tool's mapped stage, since call order already
// reflects what the model considered most relevant first. A tool with no
// mapping (shouldn't happen for a real registered tool, but never worth a
// crash over) falls back to a generic "Working on it…" rather than leaking
// its name.
export function progressForToolNames(toolNames: string[]): { stage: AssistantProgressStage; label: string } | null {
  const [first] = toolNames;
  if (!first) {
    return null;
  }
  return TOOL_PROGRESS[first] ?? FALLBACK_PROGRESS;
}
