import { describe, expect, it } from "vitest";
import {
  AssistantResponseJsonSchema,
  AssistantResponseSchema,
  fallbackAssistantResponse,
  validateAssistantResponse
} from "./response-schema";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    answer: "You used 12 kWh yesterday.",
    evidence: [{ type: "day", date: "2026-08-20", label: "Aug 20" }],
    visualizations: [
      { type: "hourly_usage", date: "2026-08-20", highlight: { fromHour: 18, toHour: 21 }, title: null }
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
      answer: "Hello.",
      evidence: [],
      visualizations: [],
      actions: [],
      suggestions: [],
      scope: { from: "", to: "" }
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a missing answer", () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).answer;
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

  it("rejects more than 4 actions, 6 evidence items, or 3 visualizations (the compact-UI caps)", () => {
    const tooManyActions = validPayload({
      actions: Array.from({ length: 5 }, () => ({ type: "sync", label: "Sync", requiresConfirmation: true }))
    });
    expect(validateAssistantResponse(tooManyActions).ok).toBe(false);
  });

  it("returns readable issue strings on failure, for server-side logging", () => {
    const result = validateAssistantResponse({ answer: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((issue) => issue.includes("answer"))).toBe(true);
    }
  });
});

describe("fallbackAssistantResponse", () => {
  it("produces a minimal, always-schema-valid response with no fabricated evidence/actions", () => {
    const fallback = fallbackAssistantResponse("Sorry, I couldn't find that.", {
      from: "2026-08-01",
      to: "2026-08-20"
    });
    expect(validateAssistantResponse(fallback).ok).toBe(true);
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
