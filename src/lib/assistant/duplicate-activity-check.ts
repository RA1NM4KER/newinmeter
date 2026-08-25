import { loadActivityReport } from "@/lib/activity/data";
import { activityOverlapsRange, addDaysToIsoDate, buildActivityRange, normalizeActivityTags } from "@/lib/activity/utils";
import type { AssistantResponsePayload } from "./response-schema";

// Deterministic duplicate-Activity guard: run against real, freshly-read
// Activity data (never left to prompt wording alone) whenever the model
// proposes add_activity. If an existing Activity already covers most/all of
// the proposed window AND shares at least one of the proposed tags, the
// proposal is rejected as a duplicate -- the model is told exactly which
// existing Activity conflicts, so it can drop the proposal (or offer
// view/edit instead) on retry.

export type DuplicateActivityViolation = {
  rule: string;
  detail: string;
};

// Same threshold family as the usage_anomaly evaluator's own
// ANOMALY_OVERLAP_FRACTION ("already explained" suppression) -- half the
// proposed window already covered by a same-tag Activity is a strong
// enough signal that this is the same real-world event, not a coincidence.
const MIN_OVERLAP_FRACTION = 0.5;

// Naive-local "YYYY-MM-DDTHH:MM:SS" strings -- appending "Z" is a
// deliberate trick for comparable epoch millis (not real UTC instants),
// safe because every value here uses the exact same convention and
// Africa/Johannesburg has no DST to fight. Mirrors alerts.ts's own
// naiveLocalMs.
function naiveLocalMs(value: string): number {
  return new Date(`${value}Z`).getTime();
}

function overlapMs(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = Math.max(naiveLocalMs(aStart), naiveLocalMs(bStart));
  const end = Math.min(naiveLocalMs(aEnd), naiveLocalMs(bEnd));
  return Math.max(0, end - start);
}

export async function checkDuplicateActivityProposals(
  response: AssistantResponsePayload,
  accessToken: string
): Promise<DuplicateActivityViolation[]> {
  const proposals = response.actions.filter(
    (action): action is Extract<AssistantResponsePayload["actions"][number], { type: "add_activity" }> =>
      action.type === "add_activity"
  );
  if (proposals.length === 0) {
    return [];
  }

  const violations: DuplicateActivityViolation[] = [];

  for (const proposal of proposals) {
    const range = buildActivityRange({ date: proposal.date, allDay: false, startTime: proposal.start, endTime: proposal.end });
    const proposedTags = normalizeActivityTags(proposal.suggestedTags);
    const proposedDurationMs = naiveLocalMs(range.endsAt) - naiveLocalMs(range.startsAt);
    if (proposedDurationMs <= 0) {
      continue;
    }

    // Widened by a day on each side so an overnight Activity that started
    // the day before (or extends into the day after) is still found -- the
    // report RPC is date-scoped, the actual overlap test below is precise.
    const searchFrom = addDaysToIsoDate(proposal.date, -1);
    const searchTo = addDaysToIsoDate(proposal.date, 1);

    let existingActivities: Array<{ startsAt: string; endsAt: string; tags: string[] }> = [];
    try {
      const { rows } = await loadActivityReport(accessToken, { from: searchFrom, to: searchTo, utility: "all" });
      existingActivities = rows;
    } catch {
      // Best-effort guard only -- a failed lookup must never block the
      // whole response, it just means this particular safety net doesn't
      // fire for this turn.
      continue;
    }

    const conflict = existingActivities.find((existing) => {
      if (!activityOverlapsRange(existing.startsAt, existing.endsAt, range.startsAt, range.endsAt)) {
        return false;
      }
      const fraction = overlapMs(range.startsAt, range.endsAt, existing.startsAt, existing.endsAt) / proposedDurationMs;
      if (fraction < MIN_OVERLAP_FRACTION) {
        return false;
      }
      // No suggested tag at all is treated as "any overlap counts" (the
      // model didn't narrow it down); otherwise require real tag overlap
      // so an unrelated existing Activity in the same window doesn't
      // wrongly suppress a genuinely different one.
      if (proposedTags.length === 0) {
        return true;
      }
      return existing.tags.some((tag) => proposedTags.includes(tag));
    });

    if (conflict) {
      violations.push({
        rule: "duplicate_activity_proposal",
        detail: `An existing Activity (${conflict.startsAt} to ${conflict.endsAt}, tags: ${conflict.tags.join(", ") || "none"}) already covers most of the proposed ${range.startsAt} to ${range.endsAt} window. Do not propose add_activity for this window -- remove that action, and if useful, mention the existing Activity or offer to update/delete it instead.`
      });
    }
  }

  return violations;
}
