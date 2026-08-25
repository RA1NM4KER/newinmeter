import { z } from "zod";
import { ALERT_TYPES, type AlertType } from "@/lib/newinmeter/alert-types";

// Single source of truth for what a valid structured assistant answer looks
// like -- the zod schema is what actually validates the model's
// submit_response tool call server-side (see openai.ts); the JSON Schema
// below is what tells the model that shape in the first place. They must
// stay in sync by hand (this codebase hand-writes every tool JSON Schema --
// see tools/schemas.ts -- rather than deriving one from the other); a test
// in response-schema.test.ts cross-checks their property sets so drift
// fails loudly instead of silently.

const alertTypeEnum = ALERT_TYPES as [AlertType, ...AlertType[]];

const AssistantEvidenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("day"), date: z.string().min(1), label: z.string().min(1) }),
  z.object({ type: z.literal("period"), from: z.string().min(1), to: z.string().min(1), label: z.string().min(1) }),
  z.object({ type: z.literal("activity"), activityId: z.string().min(1), label: z.string().min(1) }),
  z.object({ type: z.literal("alert"), alertEventId: z.string().min(1), label: z.string().min(1) }),
  z.object({ type: z.literal("data_status"), label: z.string().min(1) })
]);

// One highlighted window on an hourly chart -- an array of these lets one
// day with a morning peak AND an evening peak render as a single chart with
// two highlighted ranges, instead of two near-identical full-day charts.
const AssistantHighlightSchema = z.object({
  fromHour: z.number().int().min(0).max(23),
  toHour: z.number().int().min(1).max(24),
  label: z.string().max(40).nullable()
});

const AssistantVisualizationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hourly_usage"),
    date: z.string().min(1),
    highlights: z.array(AssistantHighlightSchema).max(3),
    title: z.string().nullable()
  }),
  z.object({
    type: z.literal("daily_usage"),
    from: z.string().min(1),
    to: z.string().min(1),
    highlightDate: z.string().nullable(),
    title: z.string().nullable()
  }),
  z.object({
    type: z.literal("period_comparison"),
    currentFrom: z.string().min(1),
    currentTo: z.string().min(1),
    previousFrom: z.string().min(1),
    previousTo: z.string().min(1),
    title: z.string().nullable()
  })
]);

const AssistantNavigateDestinationSchema = z.discriminatedUnion("page", [
  z.object({ page: z.literal("dashboard"), from: z.string().nullable(), to: z.string().nullable() }),
  z.object({
    page: z.literal("data"),
    date: z.string().nullable(),
    from: z.string().nullable(),
    to: z.string().nullable()
  }),
  z.object({ page: z.literal("activities"), date: z.string().nullable() })
]);

const AssistantActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), label: z.string().min(1), destination: AssistantNavigateDestinationSchema }),
  z.object({ type: z.literal("open_day_detail"), label: z.string().min(1), date: z.string().min(1) }),
  z.object({
    type: z.literal("add_activity"),
    label: z.string().min(1),
    date: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1),
    suggestedTags: z.array(z.string()).max(5),
    requiresConfirmation: z.literal(true)
  }),
  z.object({
    type: z.literal("update_activity"),
    label: z.string().min(1),
    // A real UUID only -- must come from a prior find_activities call, never
    // invented. Rejecting a non-UUID here (e.g. the literal "unknown") at
    // structural-validation time means a fabricated id fails the retry loop
    // BEFORE any confirm button ever renders, instead of reaching the
    // database and surfacing a raw Postgres error to the user.
    activityId: z.string().uuid(),
    date: z.string().min(1),
    start: z.string().min(1),
    end: z.string().min(1),
    tags: z.array(z.string()).max(5),
    note: z.string().max(280).nullable(),
    requiresConfirmation: z.literal(true)
  }),
  z.object({
    type: z.literal("delete_activity"),
    label: z.string().min(1),
    activityId: z.string().uuid(),
    requiresConfirmation: z.literal(true)
  }),
  z.object({
    type: z.literal("set_alert"),
    label: z.string().min(1),
    alertType: z.enum(alertTypeEnum),
    threshold: z.number().nullable(),
    requiresConfirmation: z.literal(true)
  }),
  z.object({
    type: z.literal("update_alert"),
    label: z.string().min(1),
    alertType: z.enum(alertTypeEnum),
    threshold: z.number().nullable(),
    requiresConfirmation: z.literal(true)
  }),
  z.object({
    type: z.literal("disable_alert"),
    label: z.string().min(1),
    alertType: z.enum(alertTypeEnum),
    requiresConfirmation: z.literal(true)
  }),
  z.object({ type: z.literal("sync"), label: z.string().min(1), requiresConfirmation: z.literal(true) })
]);

// A short, optionally-headed explanatory block -- e.g. heading "20:00-22:00",
// text "This was the largest evening spike." Structured fields instead of
// markdown so the UI, not the model, controls typography/spacing.
const AssistantBodyBlockSchema = z.object({
  heading: z.string().max(60).nullable(),
  text: z.string().min(1).max(280)
});

const AssistantMetricSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(40)
});

// A short one-liner only -- max ~90 chars, no newlines, and never a raw
// schema label like "Headline:" leaking through (the exact malformed shape
// observed in manual testing when the model narrated its own JSON fields as
// prose instead of calling submit_response properly).
const HEADLINE_LABEL_PREFIX = /^(headline|metrics|body|actions|suggestions)\s*:/i;

const AssistantHeadlineSchema = z
  .string()
  .min(1)
  .max(90)
  .refine((value) => !value.includes("\n"), { message: "headline must be a single line" })
  .refine((value) => !HEADLINE_LABEL_PREFIX.test(value.trim()), {
    message: "headline must not start with a schema label like 'Headline:'"
  });

export const AssistantResponseSchema = z.object({
  headline: AssistantHeadlineSchema,
  metrics: z.array(AssistantMetricSchema).max(3),
  body: z.array(AssistantBodyBlockSchema).max(3),
  evidence: z.array(AssistantEvidenceSchema).max(6),
  visualizations: z.array(AssistantVisualizationSchema).max(3),
  actions: z.array(AssistantActionSchema).max(4),
  suggestions: z.array(z.string().min(1).max(80)).max(3),
  scope: z.object({ from: z.string(), to: z.string() })
});

export type AssistantResponsePayload = z.infer<typeof AssistantResponseSchema>;

export type AssistantResponseValidation =
  | { ok: true; value: AssistantResponsePayload }
  | { ok: false; issues: string[] };

// Same-date hourly_usage entries are merged into one chart (union of
// highlight windows, deduped and capped) instead of rendering as separate
// near-identical 24-hour charts -- the model sometimes emits one per
// contributing period even though the system prompt asks for one. Other
// visualization types are deduped by their own identifying fields. Order of
// first appearance is preserved.
export function normalizeVisualizations(
  visualizations: AssistantResponsePayload["visualizations"]
): AssistantResponsePayload["visualizations"] {
  const hourlyByDate = new Map<string, Extract<AssistantResponsePayload["visualizations"][number], { type: "hourly_usage" }>>();
  const seenKeys = new Set<string>();
  const result: AssistantResponsePayload["visualizations"] = [];

  for (const visualization of visualizations) {
    if (visualization.type === "hourly_usage") {
      const existing = hourlyByDate.get(visualization.date);
      if (existing) {
        const merged = [...existing.highlights];
        for (const highlight of visualization.highlights) {
          const isDuplicate = merged.some(
            (candidate) => candidate.fromHour === highlight.fromHour && candidate.toHour === highlight.toHour
          );
          if (!isDuplicate && merged.length < 3) {
            merged.push(highlight);
          }
        }
        existing.highlights = merged;
        existing.title = existing.title ?? visualization.title;
        continue;
      }
      const clone = { ...visualization, highlights: [...visualization.highlights] };
      hourlyByDate.set(visualization.date, clone);
      result.push(clone);
      continue;
    }

    const key =
      visualization.type === "daily_usage"
        ? `daily_usage:${visualization.from}:${visualization.to}`
        : `period_comparison:${visualization.currentFrom}:${visualization.currentTo}:${visualization.previousFrom}:${visualization.previousTo}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    result.push(visualization);
  }

  return result;
}

export function validateAssistantResponse(raw: unknown): AssistantResponseValidation {
  const result = AssistantResponseSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: { ...result.data, visualizations: normalizeVisualizations(result.data.visualizations) } };
  }
  return { ok: false, issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
}

// A minimal, always-valid fallback used when the model skips submit_response
// entirely and just answers in plain text, or when its structured output
// fails validation even after a retry -- "fail gracefully rather than
// rendering random model JSON" (see openai.ts). Never fabricates evidence,
// visualizations, or actions.
export function fallbackAssistantResponse(
  headline: string,
  scope: { from: string; to: string }
): AssistantResponsePayload {
  return {
    headline,
    metrics: [],
    body: [],
    evidence: [],
    visualizations: [],
    actions: [],
    suggestions: [],
    scope
  };
}

const NULLABLE_STRING = { type: ["string", "null"] } as const;

// -- Strict JSON Schema for the submit_response function tool -------------
// OpenAI strict mode requires every object to set additionalProperties:false
// and list EVERY property (including "optional" ones) in `required`;
// optionality is expressed by allowing `null` in the property's own type
// instead of omitting it from `required`.

const evidenceSchema = {
  anyOf: [
    {
      type: "object",
      properties: { type: { type: "string", const: "day" }, date: { type: "string" }, label: { type: "string" } },
      required: ["type", "date", "label"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "period" },
        from: { type: "string" },
        to: { type: "string" },
        label: { type: "string" }
      },
      required: ["type", "from", "to", "label"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "activity" },
        activityId: { type: "string" },
        label: { type: "string" }
      },
      required: ["type", "activityId", "label"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "alert" },
        alertEventId: { type: "string" },
        label: { type: "string" }
      },
      required: ["type", "alertEventId", "label"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: { type: { type: "string", const: "data_status" }, label: { type: "string" } },
      required: ["type", "label"],
      additionalProperties: false
    }
  ]
} as const;

const highlightSchema = {
  type: "object",
  properties: {
    fromHour: { type: "integer", minimum: 0, maximum: 23 },
    toHour: { type: "integer", minimum: 1, maximum: 24 },
    label: NULLABLE_STRING
  },
  required: ["fromHour", "toHour", "label"],
  additionalProperties: false
} as const;

const visualizationSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        type: { type: "string", const: "hourly_usage" },
        date: { type: "string" },
        highlights: { type: "array", items: highlightSchema, maxItems: 3 },
        title: NULLABLE_STRING
      },
      required: ["type", "date", "highlights", "title"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "daily_usage" },
        from: { type: "string" },
        to: { type: "string" },
        highlightDate: NULLABLE_STRING,
        title: NULLABLE_STRING
      },
      required: ["type", "from", "to", "highlightDate", "title"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "period_comparison" },
        currentFrom: { type: "string" },
        currentTo: { type: "string" },
        previousFrom: { type: "string" },
        previousTo: { type: "string" },
        title: NULLABLE_STRING
      },
      required: ["type", "currentFrom", "currentTo", "previousFrom", "previousTo", "title"],
      additionalProperties: false
    }
  ]
} as const;

const navigateDestinationSchema = {
  anyOf: [
    {
      type: "object",
      properties: { page: { type: "string", const: "dashboard" }, from: NULLABLE_STRING, to: NULLABLE_STRING },
      required: ["page", "from", "to"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        page: { type: "string", const: "data" },
        date: NULLABLE_STRING,
        from: NULLABLE_STRING,
        to: NULLABLE_STRING
      },
      required: ["page", "date", "from", "to"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: { page: { type: "string", const: "activities" }, date: NULLABLE_STRING },
      required: ["page", "date"],
      additionalProperties: false
    }
  ]
} as const;

const actionSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        type: { type: "string", const: "navigate" },
        label: { type: "string" },
        destination: navigateDestinationSchema
      },
      required: ["type", "label", "destination"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "open_day_detail" },
        label: { type: "string" },
        date: { type: "string" }
      },
      required: ["type", "label", "date"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "add_activity" },
        label: { type: "string" },
        date: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        suggestedTags: { type: "array", items: { type: "string" }, maxItems: 5 },
        requiresConfirmation: { type: "boolean", const: true }
      },
      required: ["type", "label", "date", "start", "end", "suggestedTags", "requiresConfirmation"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "update_activity" },
        label: { type: "string" },
        activityId: {
          type: "string",
          description: "A real activity id from a prior find_activities call. Never invent one."
        },
        date: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        tags: { type: "array", items: { type: "string" }, maxItems: 5 },
        note: NULLABLE_STRING,
        requiresConfirmation: { type: "boolean", const: true }
      },
      required: ["type", "label", "activityId", "date", "start", "end", "tags", "note", "requiresConfirmation"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "delete_activity" },
        label: { type: "string" },
        activityId: {
          type: "string",
          description: "A real activity id from a prior find_activities call. Never invent one."
        },
        requiresConfirmation: { type: "boolean", const: true }
      },
      required: ["type", "label", "activityId", "requiresConfirmation"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "set_alert" },
        label: { type: "string" },
        alertType: { enum: ALERT_TYPES },
        threshold: { type: ["number", "null"] },
        requiresConfirmation: { type: "boolean", const: true }
      },
      required: ["type", "label", "alertType", "threshold", "requiresConfirmation"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "update_alert" },
        label: { type: "string" },
        alertType: { enum: ALERT_TYPES },
        threshold: { type: ["number", "null"] },
        requiresConfirmation: { type: "boolean", const: true }
      },
      required: ["type", "label", "alertType", "threshold", "requiresConfirmation"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "disable_alert" },
        label: { type: "string" },
        alertType: { enum: ALERT_TYPES },
        requiresConfirmation: { type: "boolean", const: true }
      },
      required: ["type", "label", "alertType", "requiresConfirmation"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        type: { type: "string", const: "sync" },
        label: { type: "string" },
        requiresConfirmation: { type: "boolean", const: true }
      },
      required: ["type", "label", "requiresConfirmation"],
      additionalProperties: false
    }
  ]
} as const;

const bodyBlockSchema = {
  type: "object",
  properties: { heading: NULLABLE_STRING, text: { type: "string" } },
  required: ["heading", "text"],
  additionalProperties: false
} as const;

const metricSchema = {
  type: "object",
  properties: { label: { type: "string" }, value: { type: "string" } },
  required: ["label", "value"],
  additionalProperties: false
} as const;

// Parameters for the submit_response function tool -- see openai.ts. The
// model must call this exactly once to finish, instead of replying with
// plain assistant text, so every final answer is app-validated shape, not
// free-form prose the UI has to parse.
export const AssistantResponseJsonSchema = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      maxLength: 90,
      description:
        "One short, concrete conclusion (under ~12 words), single line, e.g. 'Aug 13 was unusually expensive'. No markdown, no newlines, and never prefixed with a field label like 'Headline:'."
    },
    metrics: {
      type: "array",
      items: metricSchema,
      maxItems: 3,
      description: "0-3 key numbers backing the headline, e.g. {label: 'Spend', value: 'R84.20'}."
    },
    body: {
      type: "array",
      items: bodyBlockSchema,
      maxItems: 3,
      description:
        "0-3 short explanatory blocks (1-2 sentences each). Use `heading` for a short label like a time range when useful, otherwise null."
    },
    evidence: { type: "array", items: evidenceSchema, maxItems: 6 },
    visualizations: { type: "array", items: visualizationSchema, maxItems: 3 },
    actions: { type: "array", items: actionSchema, maxItems: 4 },
    suggestions: {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
      description: "0-2 short (under 6 words) natural follow-up questions. Keep this list small."
    },
    scope: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
      additionalProperties: false
    }
  },
  required: ["headline", "metrics", "body", "evidence", "visualizations", "actions", "suggestions", "scope"],
  additionalProperties: false
} as const;
