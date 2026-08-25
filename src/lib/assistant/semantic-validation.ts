import type { AssistantResponsePayload } from "./response-schema";

// Structural (JSON Schema + zod) validation only proves the response is
// SHAPED correctly -- it says nothing about whether the model just claimed
// a proposed mutation already happened, or asserted appliance-level
// causation from an Activity correlation. Prompt guidance alone has already
// been observed not to be enough (see openai.ts's repair loop, which uses
// this module's output the same way it uses schema validation issues).
//
// Every check here is scoped by "does the response actually propose this
// action / cite this kind of evidence", not applied globally -- that's
// what keeps this from rejecting legitimate historical statements like
// "You added this Activity yesterday." (no add_activity action in THIS
// response -> the add_activity check never runs) or legitimate causal
// language outside Activity attribution ("a tariff increase caused a
// higher cost per kWh" -- no activity-type evidence -> the causation check
// never runs).

export type SemanticViolation = {
  rule: string;
  detail: string;
};

const MUTATION_COMPLETION_PATTERNS: Partial<Record<AssistantResponsePayload["actions"][number]["type"], RegExp[]>> = {
  add_activity: [/\bactivit(?:y|ies)\b[^.]{0,20}\b(added|tagged|created|saved|logged)\b/i, /\b(added|tagged|created|saved|logged)\b[^.]{0,20}\bactivit(?:y|ies)\b/i, /\brecorded as an activity\b/i],
  update_activity: [/\bactivit(?:y|ies)\b[^.]{0,20}\b(updated|changed|modified)\b/i, /\b(updated|changed|modified)\b[^.]{0,20}\bactivit(?:y|ies)\b/i],
  delete_activity: [/\bactivit(?:y|ies)\b[^.]{0,20}\b(deleted|removed)\b/i, /\b(deleted|removed)\b[^.]{0,20}\bactivit(?:y|ies)\b/i],
  set_alert: [/\balert is now\b/i, /\balert has been set\b/i, /\bupdated to\b/i, /\benabled\b/i, /\bturned on\b/i, /\bis now set to\b/i],
  update_alert: [/\balert is now\b/i, /\balert has been set\b/i, /\bupdated to\b/i, /\benabled\b/i, /\bturned on\b/i, /\bis now set to\b/i],
  disable_alert: [/\bdisabled\b/i, /\bturned off\b/i],
  sync: [/\bsynced\b/i, /\brefreshed\b/i, /\bupdated your data\b/i]
};

// Appliance-level causation from a whole-home meter reading during an
// Activity's window -- NewinMeter cannot prove this, only that usage
// overlapped the labelled period. Scoped to responses that actually cite
// activity-type evidence, so legitimate causal language elsewhere (a
// tariff change causing a higher rate, a sync failure causing stale data)
// is never touched.
const ACTIVITY_CAUSATION_PATTERNS: RegExp[] = [
  /\bcaused\b/i,
  /\bresponsible for\b/i,
  /\bdrove\b/i,
  /\baccounted for\b/i,
  /\b[a-z][a-z\s]{0,24}\bused\s+\d+(?:\.\d+)?\s*kwh\b/i
];

function responseText(response: AssistantResponsePayload): string {
  return [response.headline, ...response.body.map((block) => block.text)].join(" \n ");
}

export function checkMutationCompletionClaims(response: AssistantResponsePayload): SemanticViolation[] {
  const text = responseText(response);
  const actionTypesPresent = Array.from(new Set(response.actions.map((action) => action.type)));
  const violations: SemanticViolation[] = [];

  for (const actionType of actionTypesPresent) {
    const patterns = MUTATION_COMPLETION_PATTERNS[actionType];
    if (!patterns) continue;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        violations.push({
          rule: `mutation_completion_claim:${actionType}`,
          detail: `The response proposes a "${actionType}" action but its wording implies that action has already happened. Describe it as a PROPOSAL only (e.g. "Ready to..."), never as already added/set/updated/disabled/synced -- nothing happens until the user confirms it in the UI.`
        });
        break;
      }
    }
  }

  return violations;
}

export function checkActivityCausationClaims(response: AssistantResponsePayload): SemanticViolation[] {
  const hasActivityEvidence = response.evidence.some((item) => item.type === "activity");
  if (!hasActivityEvidence) {
    return [];
  }

  const text = responseText(response);
  for (const pattern of ACTIVITY_CAUSATION_PATTERNS) {
    if (pattern.test(text)) {
      return [
        {
          rule: "activity_causation_claim",
          detail:
            "The response cites Activity evidence but its wording asserts the Activity caused/was responsible for/used a specific amount of electricity. A whole-home meter reading during an Activity's time window is only a correlation -- say it 'overlaps' the Activity, never that the Activity caused or consumed a specific amount."
        }
      ];
    }
  }

  return [];
}

export function validateSemanticRules(response: AssistantResponsePayload): SemanticViolation[] {
  return [...checkMutationCompletionClaims(response), ...checkActivityCausationClaims(response)];
}
