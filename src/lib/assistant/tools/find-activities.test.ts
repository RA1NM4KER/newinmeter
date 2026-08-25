import { describe, expect, it, vi } from "vitest";
import { buildTestContext } from "../test-fixtures";
import { findActivitiesTool } from "./find-activities";

const { loadActivitiesMock } = vi.hoisted(() => ({ loadActivitiesMock: vi.fn() }));
vi.mock("@/lib/activity/data", () => ({ loadActivities: loadActivitiesMock }));

function row(
  overrides: Partial<{
    id: string;
    date: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    tags: string[];
    note: string | null;
  }> = {}
) {
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
    loadActivitiesMock.mockResolvedValue([row()]);
    const context = buildTestContext([], [], { from: "2026-08-01", to: "2026-08-20" });

    const result = (await findActivitiesTool.handler(
      { from: null, to: null, tag: null, startTime: null, endTime: null },
      async () => context
    )) as {
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
    loadActivitiesMock.mockResolvedValue([
      row({ id: "morning", startsAt: "2026-08-20T07:00:00", endsAt: "2026-08-20T08:00:00" }),
      row({ id: "evening", startsAt: "2026-08-20T19:00:00", endsAt: "2026-08-20T20:00:00" })
    ]);
    const context = buildTestContext([], [], { from: "2026-08-01", to: "2026-08-20" });

    const result = (await findActivitiesTool.handler(
      { from: null, to: null, tag: null, startTime: "18:00", endTime: "21:00" },
      async () => context
    )) as { activities: Array<{ id: string }> };

    expect(result.activities.map((a) => a.id)).toEqual(["evening"]);
  });

  it("filters by tag", async () => {
    loadActivitiesMock.mockResolvedValue([row({ id: "match", tags: ["oven"] })]);
    const context = buildTestContext([], [], { from: "2026-08-01", to: "2026-08-20" });

    await findActivitiesTool.handler(
      { from: null, to: null, tag: "oven", startTime: null, endTime: null },
      async () => context
    );

    expect(loadActivitiesMock).toHaveBeenCalledWith("test-token", {
      from: "2026-08-01",
      to: "2026-08-20",
      tags: ["oven"]
    });
  });

  it("caps results and reports truncation metadata", async () => {
    loadActivitiesMock.mockResolvedValue(Array.from({ length: 25 }, (_, i) => row({ id: `act-${i}` })));
    const context = buildTestContext([], [], { from: "2026-08-01", to: "2026-08-20" });

    const result = (await findActivitiesTool.handler(
      { from: null, to: null, tag: null, startTime: null, endTime: null },
      async () => context
    )) as { activities: unknown[]; metadata: { matchedCount: number; returnedCount: number; truncated: boolean } };

    expect(result.activities).toHaveLength(20);
    expect(result.metadata.matchedCount).toBe(25);
    expect(result.metadata.truncated).toBe(true);
  });

  it("matches an Aug 24 22:00-05:00 Activity against the same overnight query", async () => {
    loadActivitiesMock.mockResolvedValue([
      row({ id: "overnight", date: "2026-08-24", startsAt: "2026-08-24T22:00:00", endsAt: "2026-08-25T05:00:00" })
    ]);
    const context = buildTestContext([], [], { from: "2026-08-24", to: "2026-08-24" });
    const result = (await findActivitiesTool.handler(
      { from: "2026-08-24", to: "2026-08-24", tag: "geyser", startTime: "22:00", endTime: "05:00" },
      async () => context
    )) as { activities: Array<{ id: string }> };
    expect(result.activities.map((item) => item.id)).toEqual(["overnight"]);
  });

  it("matches the overnight Activity through a 23:00-00:30 subwindow", async () => {
    loadActivitiesMock.mockResolvedValue([
      row({ id: "overnight", startsAt: "2026-08-24T22:00:00", endsAt: "2026-08-25T05:00:00" })
    ]);
    const context = buildTestContext([], [], { from: "2026-08-24", to: "2026-08-24" });
    const result = (await findActivitiesTool.handler(
      { from: "2026-08-24", to: "2026-08-24", tag: null, startTime: "23:00", endTime: "00:30" },
      async () => context
    )) as { activities: Array<{ id: string }> };
    expect(result.activities.map((item) => item.id)).toEqual(["overnight"]);
  });

  it("matches an Activity started the previous date through an Aug 25 after-midnight query", async () => {
    loadActivitiesMock.mockResolvedValue([
      row({ id: "overnight", startsAt: "2026-08-24T22:00:00", endsAt: "2026-08-25T05:00:00" })
    ]);
    const context = buildTestContext([], [], { from: "2026-08-25", to: "2026-08-25" });
    const result = (await findActivitiesTool.handler(
      { from: "2026-08-25", to: "2026-08-25", tag: null, startTime: "01:00", endTime: "02:00" },
      async () => context
    )) as { activities: Array<{ id: string }> };
    expect(result.activities.map((item) => item.id)).toEqual(["overnight"]);
  });

  it("matches a contained 22:30-23:30 Activity and excludes unrelated daytime activity", async () => {
    loadActivitiesMock.mockResolvedValue([
      row({ id: "contained", startsAt: "2026-08-24T22:30:00", endsAt: "2026-08-24T23:30:00" }),
      row({ id: "daytime", startsAt: "2026-08-24T10:00:00", endsAt: "2026-08-24T11:00:00" })
    ]);
    const context = buildTestContext([], [], { from: "2026-08-24", to: "2026-08-24" });
    const result = (await findActivitiesTool.handler(
      { from: "2026-08-24", to: "2026-08-24", tag: null, startTime: "22:00", endTime: "05:00" },
      async () => context
    )) as { activities: Array<{ id: string }> };
    expect(result.activities.map((item) => item.id)).toEqual(["contained"]);
  });

  it("uses half-open boundaries consistently and lets all-day Activities overlap", async () => {
    loadActivitiesMock.mockResolvedValue([
      row({ id: "ends-at-start", startsAt: "2026-08-24T21:00:00", endsAt: "2026-08-24T22:00:00" }),
      row({ id: "starts-at-end", startsAt: "2026-08-25T05:00:00", endsAt: "2026-08-25T06:00:00" }),
      row({ id: "all-day", startsAt: "2026-08-24T00:00:00", endsAt: "2026-08-25T00:00:00", allDay: true })
    ]);
    const context = buildTestContext([], [], { from: "2026-08-24", to: "2026-08-24" });
    const result = (await findActivitiesTool.handler(
      { from: "2026-08-24", to: "2026-08-24", tag: null, startTime: "22:00", endTime: "05:00" },
      async () => context
    )) as { activities: Array<{ id: string }> };
    expect(result.activities.map((item) => item.id)).toEqual(["all-day"]);
  });
});
