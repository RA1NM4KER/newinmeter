import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "@/lib/assistant/test-fixtures";
import type { ActivityReportRow, ActivityReportSummary } from "@/lib/types";
import { getActivityReportTool } from "./get-activity-report";

const { loadActivityReportMock } = vi.hoisted(() => ({
  loadActivityReportMock: vi.fn<
    (
      accessToken: string,
      filters: { from: string; to: string; tags?: string[]; utility?: string }
    ) => Promise<{
      rows: ActivityReportRow[];
      summary: ActivityReportSummary;
    }>
  >()
}));

vi.mock("@/lib/activity-data", () => ({
  loadActivityReport: loadActivityReportMock
}));

function activityRow(overrides: Partial<ActivityReportRow> = {}): ActivityReportRow {
  return {
    id: "activity-1",
    startsAt: "2026-08-05T18:00:00",
    endsAt: "2026-08-05T19:00:00",
    allDay: false,
    tags: ["heater"],
    color: "#0f766e",
    note: undefined,
    createdAt: "2026-08-05T10:00:00Z",
    updatedAt: "2026-08-05T10:00:00Z",
    date: "2026-08-05",
    durationMinutes: 60,
    electricityKwh: 2,
    averageKw: 2,
    electricitySpend: 6,
    waterKl: 0,
    waterSpend: 0,
    ...overrides
  };
}

function summaryFor(rows: ActivityReportRow[]): ActivityReportSummary {
  return {
    activityCount: rows.length,
    taggedDurationMinutes: rows.reduce((sum, row) => sum + row.durationMinutes, 0),
    electricityKwh: rows.reduce((sum, row) => sum + row.electricityKwh, 0),
    averageElectricityKwhPerActivity: rows.length
      ? rows.reduce((sum, row) => sum + row.electricityKwh, 0) / rows.length
      : 0,
    electricitySpend: rows.reduce((sum, row) => sum + row.electricitySpend, 0),
    waterKl: rows.reduce((sum, row) => sum + row.waterKl, 0),
    waterSpend: rows.reduce((sum, row) => sum + row.waterSpend, 0)
  };
}

const emptySummary = summaryFor([]);

async function handle(args: Record<string, unknown>, from = "2026-08-01", to = "2026-08-31") {
  const context = buildTestContext([], [], { from, to });
  return getActivityReportTool.handler(args, async () => context);
}

describe("getActivityReportTool", () => {
  beforeEach(() => {
    loadActivityReportMock.mockReset();
  });

  it("returns an empty activities list when nothing matches", async () => {
    loadActivityReportMock.mockResolvedValueOnce({ rows: [], summary: emptySummary });

    const result = (await handle({})) as { activities: unknown[]; metadata: { matchedActivityCount: number } };

    expect(result.activities).toEqual([]);
    expect(result.metadata.matchedActivityCount).toBe(0);
  });

  it("returns a single activity mapped to the compact shape", async () => {
    loadActivityReportMock.mockResolvedValueOnce({ rows: [activityRow()], summary: summaryFor([activityRow()]) });

    const result = (await handle({})) as {
      activities: Array<{ date: string; tags: string[]; electricityKwh: number }>;
    };

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0].date).toBe("2026-08-05");
    expect(result.activities[0].tags).toEqual(["heater"]);
    expect(result.activities[0].electricityKwh).toBe(2);
  });

  it("never exposes the activity database id or a connection id to the assistant", async () => {
    loadActivityReportMock.mockResolvedValueOnce({ rows: [activityRow()], summary: summaryFor([activityRow()]) });

    const result = (await handle({})) as { activities: Array<Record<string, unknown>> };

    expect(result.activities[0]).not.toHaveProperty("id");
    expect(result.activities[0]).not.toHaveProperty("connectionId");
    expect(result.activities[0]).not.toHaveProperty("connection_id");
    expect(JSON.stringify(result.activities[0])).not.toContain("activity-1");
  });

  it("normalizes and forwards tag filters to the report loader", async () => {
    loadActivityReportMock.mockResolvedValueOnce({ rows: [], summary: emptySummary });

    await handle({ tags: ["Heater", " heater ", "Pool Pump"] });

    expect(loadActivityReportMock).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({ tags: ["heater", "pool pump"] })
    );
  });

  it("forwards the electricity utility filter", async () => {
    loadActivityReportMock.mockResolvedValueOnce({ rows: [], summary: emptySummary });

    await handle({ utility: "electricity" });

    expect(loadActivityReportMock).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({ utility: "electricity" })
    );
  });

  it("forwards the water utility filter", async () => {
    loadActivityReportMock.mockResolvedValueOnce({ rows: [], summary: emptySummary });

    await handle({ utility: "water" });

    expect(loadActivityReportMock).toHaveBeenCalledWith("test-token", expect.objectContaining({ utility: "water" }));
  });

  it("groups by tag, computing totals and averages in memory from a single fetched report", async () => {
    const rows = [
      activityRow({ id: "a1", tags: ["heater"], electricityKwh: 2, electricitySpend: 6 }),
      activityRow({ id: "a2", tags: ["heater"], electricityKwh: 4, electricitySpend: 12 })
    ];
    loadActivityReportMock.mockResolvedValueOnce({ rows, summary: summaryFor(rows) });

    const result = (await handle({ groupBy: "tag" })) as {
      tags: Array<{
        tag: string;
        activityCount: number;
        totalElectricityKwh: number;
        averageElectricityKwhPerActivity: number;
      }>;
    };

    expect(loadActivityReportMock).toHaveBeenCalledTimes(1);
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].tag).toBe("heater");
    expect(result.tags[0].activityCount).toBe(2);
    expect(result.tags[0].totalElectricityKwh).toBe(6);
    expect(result.tags[0].averageElectricityKwhPerActivity).toBe(3);
  });

  it("counts an activity with multiple tags under every one of its tags", async () => {
    const rows = [activityRow({ id: "a1", tags: ["heater", "geyser"], electricityKwh: 5 })];
    loadActivityReportMock.mockResolvedValueOnce({ rows, summary: summaryFor(rows) });

    const result = (await handle({ groupBy: "tag" })) as {
      tags: Array<{ tag: string; activityCount: number; totalElectricityKwh: number }>;
    };

    const tagNames = result.tags.map((tag) => tag.tag).sort();
    expect(tagNames).toEqual(["geyser", "heater"]);
    expect(result.tags.every((tag) => tag.activityCount === 1 && tag.totalElectricityKwh === 5)).toBe(true);
  });

  it("computes grouped tag totals from every matched row, even beyond the 50-row display cap", async () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      activityRow({ id: `a${index}`, tags: ["heater"], electricityKwh: 1 })
    );
    loadActivityReportMock.mockResolvedValueOnce({ rows, summary: summaryFor(rows) });

    const result = (await handle({ groupBy: "tag" })) as {
      tags: Array<{ tag: string; activityCount: number; totalElectricityKwh: number }>;
    };

    expect(result.tags[0].activityCount).toBe(60);
    expect(result.tags[0].totalElectricityKwh).toBe(60);
  });

  it("labels grouped tag totals as overlapping, correlation-only, and based on all matched activities", async () => {
    const rows = [activityRow()];
    loadActivityReportMock.mockResolvedValueOnce({ rows, summary: summaryFor(rows) });

    const result = (await handle({ groupBy: "tag" })) as {
      metadata: { correlationOnly: boolean; totalsMayOverlap: boolean; overlapReason: string; calculatedFrom: string };
    };

    expect(result.metadata.correlationOnly).toBe(true);
    expect(result.metadata.totalsMayOverlap).toBe(true);
    expect(result.metadata.overlapReason).toMatch(/multiple tags/i);
    expect(result.metadata.calculatedFrom).toBe("allMatchedActivities");
  });

  it("excludes notes by default", async () => {
    const rows = [activityRow({ note: "Ran the heater all evening" })];
    loadActivityReportMock.mockResolvedValueOnce({ rows, summary: summaryFor(rows) });

    const result = (await handle({})) as { activities: Array<{ note?: string }> };

    expect(result.activities[0].note).toBeUndefined();
  });

  it("includes notes only when includeNotes is true", async () => {
    const rows = [activityRow({ note: "Ran the heater all evening" })];
    loadActivityReportMock.mockResolvedValueOnce({ rows, summary: summaryFor(rows) });

    const result = (await handle({ includeNotes: true })) as { activities: Array<{ note?: string }> };

    expect(result.activities[0].note).toBe("Ran the heater all evening");
  });

  it("defaults from/to to the active dashboard scope when omitted", async () => {
    loadActivityReportMock.mockResolvedValueOnce({ rows: [], summary: emptySummary });

    const result = (await handle({})) as { scope: { from: string; to: string } };

    expect(loadActivityReportMock).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({ from: "2026-08-01", to: "2026-08-31" })
    );
    expect(result.scope).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("uses an explicit valid scope within the dashboard range instead of the dashboard defaults", async () => {
    loadActivityReportMock.mockResolvedValueOnce({ rows: [], summary: emptySummary });

    const result = (await handle({ from: "2026-08-10", to: "2026-08-15" })) as { scope: { from: string; to: string } };

    expect(loadActivityReportMock).toHaveBeenCalledWith(
      "test-token",
      expect.objectContaining({ from: "2026-08-10", to: "2026-08-15" })
    );
    expect(result.scope).toEqual({ from: "2026-08-10", to: "2026-08-15" });
  });

  it("reports unavailable instead of calling the report loader when no scope can be resolved", async () => {
    const context = buildTestContext([], [], { from: "", to: "" });

    const result = (await getActivityReportTool.handler({}, async () => context)) as {
      available: boolean;
      reason: string;
    };

    expect(loadActivityReportMock).not.toHaveBeenCalled();
    expect(result.available).toBe(false);
    expect(result.reason).toBe("missing_scope");
  });

  describe("date range validation and bounds", () => {
    it("rejects an invalid explicit from date with a structured error, without throwing or calling the loader", async () => {
      const result = (await handle({ from: "not-a-date" })) as { error?: string; message?: string };

      expect(loadActivityReportMock).not.toHaveBeenCalled();
      expect(result.error).toBe("invalid_date_range");
      expect(result.message).toMatch(/valid ISO dates/i);
    });

    it("rejects an invalid explicit to date with a structured error, without throwing or calling the loader", async () => {
      const result = (await handle({ to: "2026-13-40" })) as { error?: string };

      expect(loadActivityReportMock).not.toHaveBeenCalled();
      expect(result.error).toBe("invalid_date_range");
    });

    it("rejects from after to with a structured error instead of silently swapping them", async () => {
      const result = (await handle({ from: "2026-08-20", to: "2026-08-10" })) as {
        error?: string;
        requestedScope?: { from: string; to: string };
      };

      expect(loadActivityReportMock).not.toHaveBeenCalled();
      expect(result.error).toBe("invalid_date_range");
      expect(result.requestedScope).toEqual({ from: "2026-08-20", to: "2026-08-10" });
    });

    it("accepts a range of exactly 366 days", async () => {
      loadActivityReportMock.mockResolvedValueOnce({ rows: [], summary: emptySummary });

      const result = (await handle({ from: "2026-01-01", to: "2027-01-01" })) as { scope?: unknown; error?: string };

      expect(result.error).toBeUndefined();
      expect(loadActivityReportMock).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({ from: "2026-01-01", to: "2027-01-01" })
      );
    });

    it("rejects a range greater than 366 days with a structured, non-throwing error", async () => {
      const result = (await handle({ from: "2026-01-01", to: "2027-01-02" })) as {
        error?: string;
        message?: string;
        maximumDays?: number;
        requestedScope?: { from: string; to: string };
      };

      expect(loadActivityReportMock).not.toHaveBeenCalled();
      expect(result.error).toBe("activity_range_too_large");
      expect(result.maximumDays).toBe(366);
      expect(result.requestedScope).toEqual({ from: "2026-01-01", to: "2027-01-02" });
      expect(result.message).toMatch(/366/);
    });
  });

  describe("result truncation and counts", () => {
    it("does not truncate when fewer than 50 activities match", async () => {
      const rows = Array.from({ length: 12 }, (_, index) => activityRow({ id: `a${index}` }));
      loadActivityReportMock.mockResolvedValueOnce({ rows, summary: summaryFor(rows) });

      const result = (await handle({})) as {
        activities: unknown[];
        metadata: {
          returnedActivityCount: number;
          matchedActivityCount: number;
          truncated: boolean;
          resultLimit: number;
        };
      };

      expect(result.activities).toHaveLength(12);
      expect(result.metadata.returnedActivityCount).toBe(12);
      expect(result.metadata.matchedActivityCount).toBe(12);
      expect(result.metadata.truncated).toBe(false);
      expect(result.metadata.resultLimit).toBe(50);
    });

    it("does not truncate when exactly 50 activities match", async () => {
      const rows = Array.from({ length: 50 }, (_, index) => activityRow({ id: `a${index}` }));
      loadActivityReportMock.mockResolvedValueOnce({ rows, summary: summaryFor(rows) });

      const result = (await handle({})) as {
        activities: unknown[];
        metadata: { returnedActivityCount: number; matchedActivityCount: number; truncated: boolean };
      };

      expect(result.activities).toHaveLength(50);
      expect(result.metadata.returnedActivityCount).toBe(50);
      expect(result.metadata.matchedActivityCount).toBe(50);
      expect(result.metadata.truncated).toBe(false);
    });

    it("truncates and reports accurate returned vs matched counts when more than 50 activities match", async () => {
      const rows = Array.from({ length: 60 }, (_, index) => activityRow({ id: `a${index}` }));
      loadActivityReportMock.mockResolvedValueOnce({ rows, summary: summaryFor(rows) });

      const result = (await handle({})) as {
        activities: unknown[];
        metadata: { returnedActivityCount: number; matchedActivityCount: number; truncated: boolean };
      };

      expect(result.activities).toHaveLength(50);
      expect(result.metadata.returnedActivityCount).toBe(50);
      expect(result.metadata.matchedActivityCount).toBe(60);
      expect(result.metadata.truncated).toBe(true);
    });

    it("keeps the report summary covering all matched activities, not just the truncated 50 returned", async () => {
      const rows = Array.from({ length: 60 }, (_, index) => activityRow({ id: `a${index}`, electricityKwh: 1 }));
      const fullSummary = summaryFor(rows); // electricityKwh totals across all 60, not 50
      loadActivityReportMock.mockResolvedValueOnce({ rows, summary: fullSummary });

      const result = (await handle({})) as { summary: { activityCount: number; electricityKwh: number } };

      expect(result.summary.activityCount).toBe(60);
      expect(result.summary.electricityKwh).toBe(60);
    });
  });
});
