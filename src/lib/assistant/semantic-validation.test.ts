import { describe, expect, it } from "vitest";
import { checkActivityCausationClaims, checkMutationCompletionClaims, validateSemanticRules } from "./semantic-validation";
import type { AssistantResponsePayload } from "./response-schema";

function payload(overrides: Partial<AssistantResponsePayload> = {}): AssistantResponsePayload {
  return {
    headline: "Test headline",
    metrics: [],
    body: [],
    evidence: [],
    visualizations: [],
    actions: [],
    suggestions: [],
    scope: { from: "2026-08-01", to: "2026-08-20" },
    ...overrides
  };
}

describe("checkMutationCompletionClaims", () => {
  it("flags wording that claims an add_activity proposal already happened", () => {
    const result = checkMutationCompletionClaims(
      payload({
        headline: "I've added this as an Activity",
        actions: [
          {
            type: "add_activity",
            label: "Add activity",
            date: "2026-08-20",
            start: "18:00",
            end: "19:00",
            suggestedTags: ["geyser"],
            requiresConfirmation: true
          }
        ]
      })
    );
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("mutation_completion_claim:add_activity");
  });

  it("does NOT flag a plainly historical statement with no add_activity action proposed this turn", () => {
    const result = checkMutationCompletionClaims(
      payload({ headline: "You added this Activity yesterday.", actions: [] })
    );
    expect(result).toEqual([]);
  });

  it("flags 'is now set to' when proposing set_alert", () => {
    const result = checkMutationCompletionClaims(
      payload({
        headline: "Your daily-spend alert is now set to R150",
        actions: [
          { type: "set_alert", label: "Set alert", alertType: "daily_spend", threshold: 150, requiresConfirmation: true }
        ]
      })
    );
    expect(result.some((v) => v.rule === "mutation_completion_claim:set_alert")).toBe(true);
  });

  it("does not flag correctly-worded proposal language", () => {
    const result = checkMutationCompletionClaims(
      payload({
        headline: "Ready to set your daily-spend alert to R150",
        actions: [
          { type: "set_alert", label: "Set alert", alertType: "daily_spend", threshold: 150, requiresConfirmation: true }
        ]
      })
    );
    expect(result).toEqual([]);
  });

  it("flags 'synced'/'refreshed' claims when proposing sync", () => {
    const result = checkMutationCompletionClaims(
      payload({
        headline: "Your data has been refreshed",
        actions: [{ type: "sync", label: "Sync now", requiresConfirmation: true }]
      })
    );
    expect(result.some((v) => v.rule === "mutation_completion_claim:sync")).toBe(true);
  });

  it("does not flag disable_alert wording when only update_alert is proposed", () => {
    const result = checkMutationCompletionClaims(
      payload({
        headline: "Your tariff alert has been turned off before, but that's history",
        body: [{ heading: null, text: "It was disabled last month." }],
        actions: [
          {
            type: "update_alert",
            label: "Update alert",
            alertType: "tariff_changed",
            threshold: null,
            requiresConfirmation: true
          }
        ]
      })
    );
    // "disabled" only matches the disable_alert pattern set, which isn't
    // present in actions here -- only set_alert/update_alert patterns apply,
    // and none of those match "turned off"/"disabled" wording.
    expect(result.some((v) => v.rule === "mutation_completion_claim:disable_alert")).toBe(false);
  });
});

describe("checkActivityCausationClaims", () => {
  const activityEvidence: AssistantResponsePayload["evidence"] = [
    { type: "activity", activityId: "act-1", label: "Geyser" }
  ];

  it("flags the exact 'geyser caused spike' regression case", () => {
    const result = checkActivityCausationClaims(
      payload({
        headline: "Your geyser caused the 22:30 spike",
        evidence: activityEvidence
      })
    );
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("activity_causation_claim");
  });

  it("passes correctly-worded correlation language ('overlaps')", () => {
    const result = checkActivityCausationClaims(
      payload({
        headline: "The 22:30 spike overlaps your geyser Activity",
        evidence: activityEvidence
      })
    );
    expect(result).toEqual([]);
  });

  it("flags 'used N kWh' attribution language", () => {
    const result = checkActivityCausationClaims(
      payload({
        headline: "Odd evening usage",
        body: [{ heading: null, text: "Your geyser used 4.2 kWh during that window." }],
        evidence: activityEvidence
      })
    );
    expect(result).toHaveLength(1);
  });

  it("never fires when no activity-type evidence is cited, even with causal wording elsewhere (e.g. tariff change)", () => {
    const result = checkActivityCausationClaims(
      payload({
        headline: "A tariff increase caused a higher cost per kWh",
        evidence: [{ type: "period", from: "2026-08-01", to: "2026-08-20", label: "Aug" }]
      })
    );
    expect(result).toEqual([]);
  });

  it("flags 'responsible for' and 'drove' as causation overreach", () => {
    expect(
      checkActivityCausationClaims(payload({ headline: "The geyser was responsible for this", evidence: activityEvidence }))
    ).toHaveLength(1);
    expect(
      checkActivityCausationClaims(payload({ headline: "The geyser drove the spike", evidence: activityEvidence }))
    ).toHaveLength(1);
  });
});

describe("validateSemanticRules", () => {
  it("combines both mutation-completion and causation checks", () => {
    const result = validateSemanticRules(
      payload({
        headline: "Added the Activity, which caused the spike",
        evidence: [{ type: "activity", activityId: "act-1", label: "Geyser" }],
        actions: [
          {
            type: "add_activity",
            label: "Add activity",
            date: "2026-08-20",
            start: "18:00",
            end: "19:00",
            suggestedTags: ["geyser"],
            requiresConfirmation: true
          }
        ]
      })
    );
    expect(result.map((v) => v.rule).sort()).toEqual(["activity_causation_claim", "mutation_completion_claim:add_activity"]);
  });

  it("returns no violations for a clean, correctly-worded response", () => {
    const result = validateSemanticRules(
      payload({
        headline: "Ready to add this as an Activity",
        evidence: [{ type: "activity", activityId: "act-1", label: "Geyser" }],
        actions: [
          {
            type: "add_activity",
            label: "Add activity",
            date: "2026-08-20",
            start: "18:00",
            end: "19:00",
            suggestedTags: ["geyser"],
            requiresConfirmation: true
          }
        ]
      })
    );
    expect(result).toEqual([]);
  });
});
