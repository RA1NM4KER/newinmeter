import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAssistantSystemPrompt } from "./system-prompt";

afterEach(() => vi.useRealTimers());

describe("buildAssistantSystemPrompt temporal and trust rules", () => {
  it("injects deterministic SAST today/yesterday/last-night context on every turn", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T10:00:00Z"));
    const prompt = buildAssistantSystemPrompt({}, { activitiesEnabled: true, alertsEnabled: true });
    expect(prompt).toContain("timezone=Africa/Johannesburg");
    expect(prompt).toContain("today=2026-08-25; yesterday=2026-08-24");
    expect(prompt).toContain('"Last night" means the evening of 2026-08-24 through the early morning of 2026-08-25');
    expect(prompt).toContain("preserve that referent in follow-ups");
  });

  it("makes user date correction and re-query behavior first class", () => {
    const prompt = buildAssistantSystemPrompt({}, { activitiesEnabled: true, alertsEnabled: false });
    expect(prompt).toContain("If the user corrects a date or factual referent");
    expect(prompt).toContain("re-run the relevant read tool with corrected parameters");
  });

  it("routes expensive-day analysis away from alert consequences", () => {
    const prompt = buildAssistantSystemPrompt({}, { activitiesEnabled: true, alertsEnabled: true });
    expect(prompt).toContain("For why a day was expensive, call explain_day + get_top_hours together");
    expect(prompt).toContain("alerts are notifications/consequences, not causes");
  });

  it("injects narrow app-generated delete context and requires a fresh read", () => {
    const prompt = buildAssistantSystemPrompt(
      {},
      { activitiesEnabled: true, alertsEnabled: false },
      {
        recentActionResult: {
          type: "delete_activity",
          success: true,
          deletedActivity: {
            id: "11111111-1111-4111-8111-111111111111",
            startsAt: "2026-08-24T22:00:00",
            endsAt: "2026-08-25T05:00:00",
            allDay: false,
            tags: ["geyser"]
          }
        }
      }
    );
    expect(prompt).toContain("TRUSTED RECENT ACTION RESULT");
    expect(prompt).toContain("11111111-1111-4111-8111-111111111111");
    expect(prompt).toContain("call the relevant live read tool");
    expect(prompt).toContain("report every matching Activity that remains");
  });
});
