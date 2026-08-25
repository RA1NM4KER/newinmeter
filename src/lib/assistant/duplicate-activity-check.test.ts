import { describe, expect, it, vi } from "vitest";
import { checkDuplicateActivityProposals } from "./duplicate-activity-check";
import type { AssistantResponsePayload } from "./response-schema";

const { loadActivityReportMock } = vi.hoisted(() => ({ loadActivityReportMock: vi.fn() }));
vi.mock("@/lib/activity/data", () => ({ loadActivityReport: loadActivityReportMock }));

function payload(actions: AssistantResponsePayload["actions"]): AssistantResponsePayload {
  return {
    headline: "Test",
    metrics: [],
    body: [],
    evidence: [],
    visualizations: [],
    actions,
    suggestions: [],
    scope: { from: "2026-08-01", to: "2026-08-20" }
  };
}

function addActivityAction(overrides: Partial<Extract<AssistantResponsePayload["actions"][number], { type: "add_activity" }>> = {}) {
  return {
    type: "add_activity" as const,
    label: "Add activity",
    date: "2026-08-20",
    start: "18:00",
    end: "19:00",
    suggestedTags: ["geyser"],
    requiresConfirmation: true as const,
    ...overrides
  };
}

function existingRow(overrides: Partial<{ startsAt: string; endsAt: string; tags: string[] }> = {}) {
  return { startsAt: "2026-08-20T18:00:00", endsAt: "2026-08-20T19:00:00", tags: ["geyser"], ...overrides };
}

describe("checkDuplicateActivityProposals", () => {
  it("returns no violations when there are no add_activity proposals", async () => {
    const result = await checkDuplicateActivityProposals(payload([]), "token");
    expect(result).toEqual([]);
    expect(loadActivityReportMock).not.toHaveBeenCalled();
  });

  it("suppresses an exact-duplicate proposal (same window, same tag)", async () => {
    loadActivityReportMock.mockResolvedValue({ rows: [existingRow()] });
    const result = await checkDuplicateActivityProposals(payload([addActivityAction()]), "token");
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("duplicate_activity_proposal");
  });

  it("suppresses when the existing Activity's window nests inside/covers most of the proposed window with an overlapping tag", async () => {
    loadActivityReportMock.mockResolvedValue({
      rows: [existingRow({ startsAt: "2026-08-20T17:45:00", endsAt: "2026-08-20T19:15:00" })]
    });
    const result = await checkDuplicateActivityProposals(payload([addActivityAction()]), "token");
    expect(result).toHaveLength(1);
  });

  it("does NOT suppress a partial-overlap proposal below the 50% overlap threshold", async () => {
    // Existing activity only overlaps the last 10 minutes of a 60-minute
    // proposed window -- well under MIN_OVERLAP_FRACTION.
    loadActivityReportMock.mockResolvedValue({
      rows: [existingRow({ startsAt: "2026-08-20T18:50:00", endsAt: "2026-08-20T20:00:00" })]
    });
    const result = await checkDuplicateActivityProposals(payload([addActivityAction()]), "token");
    expect(result).toEqual([]);
  });

  it("does NOT suppress when the existing Activity fully overlaps but shares no tag with the proposal", async () => {
    loadActivityReportMock.mockResolvedValue({ rows: [existingRow({ tags: ["oven"] })] });
    const result = await checkDuplicateActivityProposals(payload([addActivityAction()]), "token");
    expect(result).toEqual([]);
  });

  it("suppresses when the proposal has no suggested tags at all -- any sufficient overlap counts", async () => {
    loadActivityReportMock.mockResolvedValue({ rows: [existingRow({ tags: ["oven"] })] });
    const result = await checkDuplicateActivityProposals(
      payload([addActivityAction({ suggestedTags: [] })]),
      "token"
    );
    expect(result).toHaveLength(1);
  });

  it("handles an overnight existing Activity correctly (crosses midnight)", async () => {
    loadActivityReportMock.mockResolvedValue({
      rows: [existingRow({ startsAt: "2026-08-19T22:00:00", endsAt: "2026-08-20T05:00:00", tags: ["geyser"] })]
    });
    // Proposed window is entirely inside the overnight existing window.
    const result = await checkDuplicateActivityProposals(
      payload([addActivityAction({ date: "2026-08-20", start: "02:00", end: "03:00" })]),
      "token"
    );
    expect(result).toHaveLength(1);
  });

  it("never blocks the whole response if the Activity lookup itself fails", async () => {
    loadActivityReportMock.mockRejectedValue(new Error("db down"));
    const result = await checkDuplicateActivityProposals(payload([addActivityAction()]), "token");
    expect(result).toEqual([]);
  });

  it("widens the report query by a day on each side of the proposed date", async () => {
    loadActivityReportMock.mockResolvedValue({ rows: [] });
    await checkDuplicateActivityProposals(payload([addActivityAction({ date: "2026-08-20" })]), "token");
    expect(loadActivityReportMock).toHaveBeenCalledWith("token", {
      from: "2026-08-19",
      to: "2026-08-21",
      utility: "all"
    });
  });
});
