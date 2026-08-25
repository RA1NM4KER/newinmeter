import type { AssistantResponsePayload } from "./response-schema";
import type { AssistantContext } from "./types";

export type SemanticViolation = { rule: string; detail: string };
export type SemanticValidationContext = {
  response: AssistantResponsePayload;
  toolsUsed?: Iterable<string>;
  question?: string;
  trustedContext?: AssistantContext;
  toolResults?: Array<{ toolName: string; payload: unknown }>;
};

const MUTATION_COMPLETION_PATTERNS: Partial<Record<AssistantResponsePayload["actions"][number]["type"], RegExp[]>> = {
  add_activity: [
    /\bactivit(?:y|ies)\b[^.]{0,20}\b(added|tagged|created|saved|logged)\b/i,
    /\b(added|tagged|created|saved|logged)\b[^.]{0,20}\bactivit(?:y|ies)\b/i,
    /\brecorded as an activity\b/i
  ],
  update_activity: [
    /\bactivit(?:y|ies)\b[^.]{0,20}\b(updated|changed|modified)\b/i,
    /\b(updated|changed|modified)\b[^.]{0,20}\bactivit(?:y|ies)\b/i
  ],
  delete_activity: [
    /\bactivit(?:y|ies)\b[^.]{0,20}\b(deleted|removed)\b/i,
    /\b(deleted|removed)\b[^.]{0,20}\bactivit(?:y|ies)\b/i
  ],
  set_alert: [
    /\balert is now\b/i,
    /\balert has been set\b/i,
    /\bupdated to\b/i,
    /\benabled\b/i,
    /\bturned on\b/i,
    /\bis now set to\b/i
  ],
  update_alert: [
    /\balert is now\b/i,
    /\balert has been set\b/i,
    /\bupdated to\b/i,
    /\benabled\b/i,
    /\bturned on\b/i,
    /\bis now set to\b/i
  ],
  disable_alert: [/\bdisabled\b/i, /\bturned off\b/i],
  sync: [/\bsynced\b/i, /\brefreshed\b/i, /\bupdated your data\b/i]
};

const ACTIVITY_TOOLS = new Set(["get_activity_report", "find_activities", "inspect_time_window"]);

function responseText(response: AssistantResponsePayload): string {
  return [response.headline, ...response.body.map((block) => block.text)].join(" \n ");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectActivityLabels(context: SemanticValidationContext): string[] {
  const labels = context.response.evidence
    .filter((item) => item.type === "activity")
    .map((item) => item.label.trim().toLocaleLowerCase("en-ZA"));
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (key === "tags" && Array.isArray(item)) {
          for (const tag of item) if (typeof tag === "string") labels.push(tag.toLocaleLowerCase("en-ZA"));
        } else visit(item);
      }
    }
  };
  for (const result of context.toolResults ?? []) {
    if (ACTIVITY_TOOLS.has(result.toolName)) visit(result.payload);
  }
  return Array.from(new Set(labels.filter(Boolean)));
}

export function checkMutationCompletionClaims(response: AssistantResponsePayload): SemanticViolation[] {
  const text = responseText(response);
  const actionTypesPresent = Array.from(new Set(response.actions.map((action) => action.type)));
  const violations: SemanticViolation[] = [];
  for (const actionType of actionTypesPresent) {
    const patterns = MUTATION_COMPLETION_PATTERNS[actionType];
    if (patterns?.some((pattern) => pattern.test(text))) {
      violations.push({
        rule: `mutation_completion_claim:${actionType}`,
        detail: `The response proposes a "${actionType}" action but implies it already happened. Describe it only as a proposal pending confirmation.`
      });
    }
  }
  return violations;
}

export function checkActivityCausationClaims(
  response: AssistantResponsePayload,
  toolsUsed: Iterable<string> = [],
  toolResults: SemanticValidationContext["toolResults"] = []
): SemanticViolation[] {
  const activityInformed =
    response.evidence.some((item) => item.type === "activity") ||
    Array.from(toolsUsed).some((tool) => ACTIVITY_TOOLS.has(tool));
  if (!activityInformed) return [];

  const labels = collectActivityLabels({ response, toolsUsed, toolResults });
  const subject = ["activity", ...labels].map(escapeRegex).join("|");
  const text = responseText(response);
  const patterns = [
    new RegExp(`\\b(?:${subject})\\b[^.!?]{0,100}\\bcaus(?:ed|ing)\\b`, "i"),
    new RegExp(`\\b(?:${subject})\\s+(?:activity\\s+)?(?:used|using|consumed)\\s+(?:\\d|R\\s?\\d)`, "i"),
    new RegExp(`\\b(?:${subject})\\b[^.!?]{0,80}\\b(?:responsible for|drove|accounted for)\\b`, "i"),
    new RegExp(`\\busage from (?:the |your )?(?:${subject})\\b`, "i")
  ];
  if (!patterns.some((pattern) => pattern.test(text))) return [];
  return [
    {
      rule: "activity_causation_claim",
      detail:
        "Activity timing only correlates with whole-home meter data. Say usage was recorded during or overlaps the labelled period; never say the Activity caused, used, consumed, drove, or was responsible for usage/spend."
    }
  ];
}

function isVerificationQuestion(question: string) {
  return /\b(check|verify|did you|was it|were both|what(?:'s| is) left|what remains|still (?:there|remain))\b/i.test(
    question
  );
}

export function checkDeleteVerificationClaims(context: SemanticValidationContext): SemanticViolation[] {
  const recent = context.trustedContext?.recentActionResult;
  if (recent?.type !== "delete_activity" || !isVerificationQuestion(context.question ?? "")) return [];
  const payload = (context.toolResults ?? [])
    .filter((result) => result.toolName === "find_activities")
    .map((result) => result.payload as { activities?: Array<{ id?: string; startsAt?: string; endsAt?: string }> })
    .filter((result) => Array.isArray(result.activities))
    .at(-1);
  if (!payload) {
    return [
      { rule: "delete_verification_requires_live_read", detail: "Call find_activities before verifying a deletion." }
    ];
  }
  const activities = payload.activities ?? [];
  const deletedStillPresent = activities.some((item) => item.id === recent.deletedActivity.id);
  const remaining = activities.filter((item) => item.id !== recent.deletedActivity.id);
  const text = responseText(context.response);
  if (deletedStillPresent && !/still (?:exists|there|present)|not (?:deleted|gone|removed)/i.test(text)) {
    return [
      {
        rule: "delete_verification_incorrect",
        detail: "The deleted Activity id remains in live state; say deletion is not verified."
      }
    ];
  }
  if (!deletedStillPresent && remaining.length > 0) {
    const mentionsRemaining = remaining.every((item) => {
      const start = item.startsAt?.slice(11, 16);
      const end = item.endsAt?.slice(11, 16);
      return Boolean(start && end && text.includes(start) && text.includes(end));
    });
    if (!mentionsRemaining || !/still (?:remains?|there|exists|present)/i.test(text)) {
      return [
        {
          rule: "delete_verification_scope",
          detail:
            "One Activity was deleted but matching Activities remain. State that only the exact deleted Activity is gone and list each remaining start/end time from find_activities."
        }
      ];
    }
  }
  return [];
}

export function validateSemanticRules(context: SemanticValidationContext): SemanticViolation[] {
  return [
    ...checkMutationCompletionClaims(context.response),
    ...checkActivityCausationClaims(context.response, context.toolsUsed, context.toolResults),
    ...checkDeleteVerificationClaims(context)
  ];
}
