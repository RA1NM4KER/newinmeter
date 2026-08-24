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

const AssistantVisualizationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hourly_usage"),
    date: z.string().min(1),
    highlight: z
      .object({ fromHour: z.number().int().min(0).max(23), toHour: z.number().int().min(1).max(24) })
      .nullable(),
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

export const AssistantResponseSchema = z.object({
  answer: z.string().min(1).max(4000),
  evidence: z.array(AssistantEvidenceSchema).max(6),
  visualizations: z.array(AssistantVisualizationSchema).max(3),
  actions: z.array(AssistantActionSchema).max(4),
  suggestions: z.array(z.string().min(1).max(140)).max(4),
  scope: z.object({ from: z.string(), to: z.string() })
});

export type AssistantResponsePayload = z.infer<typeof AssistantResponseSchema>;

export type AssistantResponseValidation =
  | { ok: true; value: AssistantResponsePayload }
  | { ok: false; issues: string[] };

export function validateAssistantResponse(raw: unknown): AssistantResponseValidation {
  const result = AssistantResponseSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) };
}

// A minimal, always-valid fallback used when the model skips submit_response
// entirely and just answers in plain text, or when its structured output
// fails validation even after a retry -- "fail gracefully rather than
// rendering random model JSON" (see openai.ts). Never fabricates evidence,
// visualizations, or actions.
export function fallbackAssistantResponse(
  answer: string,
  scope: { from: string; to: string }
): AssistantResponsePayload {
  return {
    answer,
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

const visualizationSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        type: { type: "string", const: "hourly_usage" },
        date: { type: "string" },
        highlight: {
          anyOf: [
            {
              type: "object",
              properties: {
                fromHour: { type: "integer", minimum: 0, maximum: 23 },
                toHour: { type: "integer", minimum: 1, maximum: 24 }
              },
              required: ["fromHour", "toHour"],
              additionalProperties: false
            },
            { type: "null" }
          ]
        },
        title: NULLABLE_STRING
      },
      required: ["type", "date", "highlight", "title"],
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

// Parameters for the submit_response function tool -- see openai.ts. The
// model must call this exactly once to finish, instead of replying with
// plain assistant text, so every final answer is app-validated shape, not
// free-form prose the UI has to parse.
export const AssistantResponseJsonSchema = {
  type: "object",
  properties: {
    answer: { type: "string", description: "Concise, grounded answer in plain language. No markdown headers." },
    evidence: { type: "array", items: evidenceSchema, maxItems: 6 },
    visualizations: { type: "array", items: visualizationSchema, maxItems: 3 },
    actions: { type: "array", items: actionSchema, maxItems: 4 },
    suggestions: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
      description: "Up to 4 short, natural follow-up questions the user might ask next."
    },
    scope: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
      additionalProperties: false
    }
  },
  required: ["answer", "evidence", "visualizations", "actions", "suggestions", "scope"],
  additionalProperties: false
} as const;
