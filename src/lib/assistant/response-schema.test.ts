import { describe, expect, it } from "vitest";
import {
  AssistantResponseJsonSchema,
  AssistantResponseSchema,
  fallbackAssistantResponse,
  normalizeVisualizations,
  validateAssistantResponse
} from "./response-schema";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    headline: "Aug 13 was unusually expensive",
    metrics: [{ label: "Spend", value: "R84.20" }],
    body: [{ heading: "20:00-22:00", text: "This was the largest evening spike." }],
    evidence: [{ type: "day", date: "2026-08-20", label: "Aug 20" }],
    visualizations: [
      {
        type: "hourly_usage",
        date: "2026-08-20",
        highlights: [{ fromHour: 18, toHour: 21, label: "Evening spike" }],
        title: null
      }
    ],
    actions: [
      { type: "navigate", label: "View day", destination: { page: "data", date: "2026-08-20", from: null, to: null } }
    ],
    suggestions: ["Why was it high?"],
    scope: { from: "2026-08-01", to: "2026-08-20" },
    ...overrides
  };
}

describe("validateAssistantResponse", () => {
  it("accepts a fully populated, valid payload", () => {
    const result = validateAssistantResponse(validPayload());
    expect(result.ok).toBe(true);
  });

  it("accepts the minimal empty-arrays shape", () => {
    const result = validateAssistantResponse({
      headline: "Hello.",
      metrics: [],
      body: [],
      evidence: [],
      visualizations: [],
      actions: [],
      suggestions: [],
      scope: { from: "", to: "" }
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing headline", () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).headline;
    expect(validateAssistantResponse(payload).ok).toBe(false);
  });

  it("rejects an unknown evidence type", () => {
    const result = validateAssistantResponse(validPayload({ evidence: [{ type: "bogus", label: "x" }] }));
    expect(result.ok).toBe(false);
  });

  it("rejects an action missing requiresConfirmation", () => {
    const result = validateAssistantResponse(validPayload({ actions: [{ type: "sync", label: "Sync now" }] }));
    expect(result.ok).toBe(false);
  });

  it("rejects requiresConfirmation: false on a mutating action -- the literal-true type makes this structurally impossible to satisfy", () => {
    const result = validateAssistantResponse(
      validPayload({ actions: [{ type: "sync", label: "Sync now", requiresConfirmation: false }] })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an arbitrary alert type invented by the model", () => {
    const result = validateAssistantResponse(
      validPayload({
        actions: [
          {
            type: "set_alert",
            label: "x",
            alertType: "totally_made_up_alert",
            threshold: 100,
            requiresConfirmation: true
          }
        ]
      })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an arbitrary navigation page invented by the model", () => {
    const result = validateAssistantResponse(
      validPayload({
        actions: [{ type: "navigate", label: "x", destination: { page: "settings", url: "/settings" } }]
      })
    );
    expect(result.ok).toBe(false);
  });

  it("rejects more than 4 actions, 6 evidence items, 3 visualizations, 3 metrics, 3 body blocks, or 3 suggestions (the compact-UI caps)", () => {
    const tooManyActions = validPayload({
      actions: Array.from({ length: 5 }, () => ({ type: "sync", label: "Sync", requiresConfirmation: true }))
    });
    expect(validateAssistantResponse(tooManyActions).ok).toBe(false);

    const tooManySuggestions = validPayload({ suggestions: ["a", "b", "c", "d"] });
    expect(validateAssistantResponse(tooManySuggestions).ok).toBe(false);

    const tooManyMetrics = validPayload({
      metrics: [
        { label: "a", value: "1" },
        { label: "b", value: "2" },
        { label: "c", value: "3" },
        { label: "d", value: "4" }
      ]
    });
    expect(validateAssistantResponse(tooManyMetrics).ok).toBe(false);
  });

  it("accepts open_day_detail, update_activity, and delete_activity actions", () => {
    const openDayDetail = validateAssistantResponse(
      validPayload({ actions: [{ type: "open_day_detail", label: "View day", date: "2026-08-20" }] })
    );
    expect(openDayDetail.ok).toBe(true);

    const updateActivity = validateAssistantResponse(
      validPayload({
        actions: [
          {
            type: "update_activity",
            label: "Update activity",
            activityId: "act-1",
            date: "2026-08-20",
            start: "18:00",
            end: "19:00",
            tags: ["geyser"],
            note: null,
            requiresConfirmation: true
          }
        ]
      })
    );
    expect(updateActivity.ok).toBe(true);

    const deleteActivity = validateAssistantResponse(
      validPayload({
        actions: [{ type: "delete_activity", label: "Delete activity", activityId: "act-1", requiresConfirmation: true }]
      })
    );
    expect(deleteActivity.ok).toBe(true);
  });

  it("rejects update_activity/delete_activity missing requiresConfirmation: true", () => {
    const result = validateAssistantResponse(
      validPayload({
        actions: [{ type: "delete_activity", label: "Delete activity", activityId: "act-1" }]
      })
    );
    expect(result.ok).toBe(false);
  });

  describe("strengthened headline validation", () => {
    it("rejects a headline over ~90 characters", () => {
      const result = validateAssistantResponse(validPayload({ headline: "x".repeat(91) }));
      expect(result.ok).toBe(false);
    });

    it("rejects a multi-line headline", () => {
      const result = validateAssistantResponse(validPayload({ headline: "First line\nSecond line" }));
      expect(result.ok).toBe(false);
    });

    it("rejects a headline prefixed with a schema label -- the exact malformed shape observed in manual testing", () => {
      const result = validateAssistantResponse(
        validPayload({ headline: "Headline: No new alert tonight due to timing rules" })
      );
      expect(result.ok).toBe(false);
    });

    it("rejects other schema-label prefixes case-insensitively", () => {
      expect(validateAssistantResponse(validPayload({ headline: "metrics: Spend R84.20" })).ok).toBe(false);
      expect(validateAssistantResponse(validPayload({ headline: "Body: This was unusual" })).ok).toBe(false);
      expect(validateAssistantResponse(validPayload({ headline: "Actions: Add activity" })).ok).toBe(false);
      expect(validateAssistantResponse(validPayload({ headline: "Suggestions: Why?" })).ok).toBe(false);
    });

    it("accepts a normal short single-line headline", () => {
      const result = validateAssistantResponse(validPayload({ headline: "Aug 13 was unusually expensive" }));
      expect(result.ok).toBe(true);
    });
  });

  it("returns readable issue strings on failure, for server-side logging", () => {
    const result = validateAssistantResponse({ headline: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((issue) => issue.includes("headline"))).toBe(true);
    }
  });

  it("merges duplicate same-date hourly_usage visualizations into one chart with combined highlights", () => {
    const result = validateAssistantResponse(
      validPayload({
        visualizations: [
          {
            type: "hourly_usage",
            date: "2026-08-13",
            highlights: [{ fromHour: 9, toHour: 10, label: "Morning" }],
            title: "Morning"
          },
          {
            type: "hourly_usage",
            date: "2026-08-13",
            highlights: [{ fromHour: 20, toHour: 22, label: "Evening" }],
            title: null
          }
        ]
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.visualizations).toHaveLength(1);
      const [chart] = result.value.visualizations;
      expect(chart.type).toBe("hourly_usage");
      if (chart.type === "hourly_usage") {
        expect(chart.highlights).toEqual([
          { fromHour: 9, toHour: 10, label: "Morning" },
          { fromHour: 20, toHour: 22, label: "Evening" }
        ]);
        expect(chart.title).toBe("Morning");
      }
    }
  });
});

describe("normalizeVisualizations", () => {
  it("is a no-op for already-distinct visualizations", () => {
    const input = validPayload().visualizations as ReturnType<typeof normalizeVisualizations>;
    expect(normalizeVisualizations(input)).toHaveLength(1);
  });

  it("drops an exact-duplicate highlight window instead of listing it twice", () => {
    const merged = normalizeVisualizations([
      { type: "hourly_usage", date: "2026-08-13", highlights: [{ fromHour: 18, toHour: 21, label: "Evening" }], title: null },
      { type: "hourly_usage", date: "2026-08-13", highlights: [{ fromHour: 18, toHour: 21, label: "Evening" }], title: null }
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe("hourly_usage");
    if (merged[0].type === "hourly_usage") {
      expect(merged[0].highlights).toHaveLength(1);
    }
  });

  it("dedupes daily_usage visualizations by from/to", () => {
    const merged = normalizeVisualizations([
      { type: "daily_usage", from: "2026-08-01", to: "2026-08-20", highlightDate: "2026-08-13", title: null },
      { type: "daily_usage", from: "2026-08-01", to: "2026-08-20", highlightDate: "2026-08-13", title: "again" }
    ]);
    expect(merged).toHaveLength(1);
  });

  it("keeps hourly_usage visualizations for different dates as separate charts", () => {
    const merged = normalizeVisualizations([
      { type: "hourly_usage", date: "2026-08-13", highlights: [], title: null },
      { type: "hourly_usage", date: "2026-08-14", highlights: [], title: null }
    ]);
    expect(merged).toHaveLength(2);
  });
});

describe("fallbackAssistantResponse", () => {
  it("produces a minimal, always-schema-valid response with no fabricated evidence/actions", () => {
    const fallback = fallbackAssistantResponse("Sorry, I couldn't find that.", {
      from: "2026-08-01",
      to: "2026-08-20"
    });
    expect(validateAssistantResponse(fallback).ok).toBe(true);
    expect(fallback.metrics).toEqual([]);
    expect(fallback.body).toEqual([]);
    expect(fallback.evidence).toEqual([]);
    expect(fallback.visualizations).toEqual([]);
    expect(fallback.actions).toEqual([]);
    expect(fallback.suggestions).toEqual([]);
  });
});

// The JSON Schema handed to the model (submit_response's parameters) and the
// zod schema that actually validates its output are maintained by hand
// together (see response-schema.ts's own module comment) -- this is the
// safety net that catches them drifting apart: every zod-required top-level
// key must also be `required` in the JSON Schema, and vice versa.
describe("AssistantResponseJsonSchema / AssistantResponseSchema stay in sync", () => {
  it("share the exact same top-level required property set", () => {
    const zodKeys = Object.keys(AssistantResponseSchema.shape).sort();
    const jsonSchemaKeys = [...AssistantResponseJsonSchema.required].sort();
    expect(jsonSchemaKeys).toEqual(zodKeys);
    expect(Object.keys(AssistantResponseJsonSchema.properties).sort()).toEqual(zodKeys);
  });

  it("is additionalProperties: false at the top level and every nested anyOf branch", () => {
    expect(AssistantResponseJsonSchema.additionalProperties).toBe(false);

    function collectObjectSchemas(node: unknown, out: Array<Record<string, unknown>>): void {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object") out.push(obj);
      for (const value of Object.values(obj)) {
        if (Array.isArray(value)) {
          for (const item of value) collectObjectSchemas(item, out);
        } else if (value && typeof value === "object") {
          collectObjectSchemas(value, out);
        }
      }
    }

    const objectSchemas: Array<Record<string, unknown>> = [];
    collectObjectSchemas(AssistantResponseJsonSchema, objectSchemas);
    expect(objectSchemas.length).toBeGreaterThan(5);
    for (const schema of objectSchemas) {
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
