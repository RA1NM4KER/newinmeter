import { describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../test-fixtures";
import { findActivitiesTool } from "./find-activities";

const { loadActivityReportMock } = vi.hoisted(() => ({ loadActivityReportMock: vi.fn() }));
vi.mock("@/lib/activity/data", () => ({ loadActivityReport: loadActivityReportMock }));

function row(overrides: Partial<{ id: string; date: string; startsAt: string; endsAt: string; allDay: boolean; tags: string[]; note: string | null }> = {}) {
  return {
    id: "act-1",
    date: "2026-08-20",
    startsAt: "2026-08-20T18:00:00",
    endsAt: "2026-08-20T19:00:00",
    allDay: false,
    tags: ["geyser"],
    note: null,
    ...overrides
  };
}

describe("find_activities", () => {
  it("returns real activity ids -- the only tool that does, unlike get_activity_report", async () => {
    loadActivityReportMock.mockResolvedValue({ rows: [row()] });
    const context = buildTestContext([], [], { from: "2026-08-01", to: "2026-08-20" });

    const result = (await findActivitiesTool.handler({ from: null, to: null, tag: null, startTime: null, endTime: null }, async () => context)) as {
      activities: Array<{ id: string }>;
    };

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].id).toBe("act-1");
  });

  it("rejects an invalid date range", async () => {
    const context = buildTestContext([], [], { from: "2026-08-01", to: "2026-08-20" });
    const result = (await findActivitiesTool.handler(
      { from: "2026-08-20", to: "2026-08-01", tag: null, startTime: null, endTime: null },
      async () => context
    )) as { error?: string };
    expect(result.error).toBe("invalid_date_range");
  });

  it("filters by a time-of-day window across the returned rows", async () => {
    loadActivityReportMock.mockResolvedValue({
      rows: [
        row({ id: "morning", startsAt: "2026-08-20T07:00:00", endsAt: "2026-08-20T08:00:00" }),
        row({ id: "evening", startsAt: "2026-08-20T19:00:00", endsAt: "2026-08-20T20:00:00" })
      ]
    });
    const context = buildTestContext([], [], { from: "2026-08-01", to: "2026-08-20" });

    const result = (await findActivitiesTool.handler(
      { from: null, to: null, tag: null, startTime: "18:00", endTime: "21:00" },
      async () => context
    )) as { activities: Array<{ id: string }> };

    expect(result.activities.map((a) => a.id)).toEqual(["evening"]);
  });

  it("filters by tag", async () => {
    loadActivityReportMock.mockResolvedValue({ rows: [row({ id: "match", tags: ["oven"] })] });
    const context = buildTestContext([], [], { from: "2026-08-01", to: "2026-08-20" });

    await findActivitiesTool.handler({ from: null, to: null, tag: "oven", startTime: null, endTime: null }, async () => context);

    expect(loadActivityReportMock).toHaveBeenCalledWith("test-token", {
      from: "2026-08-01",
      to: "2026-08-20",
      tags: ["oven"],
      utility: "all"
    });
  });

  it("caps results and reports truncation metadata", async () => {
    loadActivityReportMock.mockResolvedValue({ rows: Array.from({ length: 25 }, (_, i) => row({ id: `act-${i}` })) });
    const context = buildTestContext([], [], { from: "2026-08-01", to: "2026-08-20" });

    const result = (await findActivitiesTool.handler(
      { from: null, to: null, tag: null, startTime: null, endTime: null },
      async () => context
    )) as { activities: unknown[]; metadata: { matchedCount: number; returnedCount: number; truncated: boolean } };

    expect(result.activities).toHaveLength(20);
    expect(result.metadata.matchedCount).toBe(25);
    expect(result.metadata.truncated).toBe(true);
  });
});
