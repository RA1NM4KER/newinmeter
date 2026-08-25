import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext, hourlyRow } from "../test-fixtures";
import { explainAlertTool } from "./explain-alert";

const mocks = vi.hoisted(() => ({
  getAlertEventDetail: vi.fn(),
  loadActivityReport: vi.fn(),
  getAlertRulesForUser: vi.fn()
}));
vi.mock("@/lib/newinmeter/alerts", () => ({
  getAlertEventDetail: mocks.getAlertEventDetail,
  getAlertRulesForUser: mocks.getAlertRulesForUser
}));
vi.mock("@/lib/activity/data", () => ({ loadActivityReport: mocks.loadActivityReport }));

describe("explain_alert", () => {
  beforeEach(() => {
    mocks.getAlertRulesForUser.mockReset().mockResolvedValue([]);
  });

  it("returns missing_alert_event_id when called with no id", async () => {
    const context = buildTestContext([], [], { from: "", to: "" });
    const result = await explainAlertTool.handler({}, async () => context);
    expect(result).toEqual({ error: "missing_alert_event_id" });
    expect(mocks.getAlertEventDetail).not.toHaveBeenCalled();
  });

  it("resolves ownership via context.userId, never a client-supplied user id, and returns not_found for an unowned/nonexistent event without distinguishing the two", async () => {
    mocks.getAlertEventDetail.mockResolvedValue(null);
    const context = buildTestContext([], [], { from: "", to: "" }, { userId: "the-real-user" });

    const result = await explainAlertTool.handler({ alertEventId: "evt-1" }, async () => context);

    expect(mocks.getAlertEventDetail).toHaveBeenCalledWith("the-real-user", "evt-1");
    expect(result).toEqual({ error: "not_found", alertEventId: "evt-1" });
  });

  it("passes non-usage_anomaly event_context straight through, unmodified, since the evaluator already computed the exact numbers", async () => {
    mocks.getAlertEventDetail.mockResolvedValue({
      id: "evt-1",
      type: "monthly_budget",
      title: "Spending is ahead of budget",
      body: "...",
      navigateUrl: "/",
      triggeredAt: "2026-08-20T10:00:00Z",
      triggerValue: 950,
      thresholdValue: 800,
      context: { monthToDateSpend: 500, projectedSpend: 950, budget: 800 },
      resolvedAt: null,
      isRead: false
    });
    const context = buildTestContext([], [], { from: "", to: "" });

    const result = (await explainAlertTool.handler({ alertEventId: "evt-1" }, async () => context)) as {
      resolved: boolean;
      context: Record<string, unknown> | null;
    };

    expect(result.resolved).toBe(false);
    expect(result.context).toEqual({ monthToDateSpend: 500, projectedSpend: 950, budget: 800 });
  });

  it("for usage_anomaly, builds hourly context around the window and marks alreadyExplained from resolvedAt", async () => {
    mocks.getAlertEventDetail.mockResolvedValue({
      id: "evt-2",
      type: "usage_anomaly",
      title: "What happened around 7 PM?",
      body: "...",
      navigateUrl: "/activities?new=1",
      triggeredAt: "2026-08-20T19:00:00Z",
      triggerValue: 4.2,
      thresholdValue: null,
      context: { startAt: "2026-08-20T18:00:00", endAt: "2026-08-20T20:00:00", usageKwh: 4.7, baselineKwh: 2.1 },
      resolvedAt: "2026-08-20T21:00:00Z",
      isRead: true
    });
    const context = buildTestContext(
      [],
      [
        hourlyRow({ periodDate: "2026-08-20", hour: 17, kwh: 0.5 }),
        hourlyRow({ periodDate: "2026-08-20", hour: 18, kwh: 3.0 }),
        hourlyRow({ periodDate: "2026-08-20", hour: 19, kwh: 4.7 }),
        hourlyRow({ periodDate: "2026-08-20", hour: 21, kwh: 0.4 })
      ],
      { from: "", to: "" },
      { permissions: { activitiesEnabled: false, alertsEnabled: true } }
    );

    const result = (await explainAlertTool.handler({ alertEventId: "evt-2" }, async () => context)) as {
      alreadyExplained: boolean;
      hourlyContext: Array<{ hour: number }>;
      relatedActivities: unknown[];
      activitiesAvailable: boolean;
    };

    expect(result.alreadyExplained).toBe(true);
    // Window is [startHour-2, endHour+1] = [16, 21]; only hours actually
    // present in the fixture's hourlyRows show up.
    expect(result.hourlyContext.map((row) => row.hour)).toEqual([17, 18, 19, 21]);
    expect(result.activitiesAvailable).toBe(false);
    expect(result.relatedActivities).toEqual([]);
    expect(mocks.loadActivityReport).not.toHaveBeenCalled();
  });

  it("only pulls related Activities when Activities is enabled for the account", async () => {
    mocks.getAlertEventDetail.mockResolvedValue({
      id: "evt-3",
      type: "usage_anomaly",
      title: "What happened?",
      body: "...",
      navigateUrl: "/",
      triggeredAt: "2026-08-20T19:00:00Z",
      triggerValue: 4.2,
      thresholdValue: null,
      context: { startAt: "2026-08-20T18:00:00", endAt: "2026-08-20T20:00:00", usageKwh: 4.7, baselineKwh: 2.1 },
      resolvedAt: null,
      isRead: false
    });
    mocks.loadActivityReport.mockResolvedValue({
      rows: [
        { startsAt: "2026-08-20T18:30:00", endsAt: "2026-08-20T19:30:00", tags: ["geyser"] },
        { startsAt: "2026-08-20T22:00:00", endsAt: "2026-08-20T23:00:00", tags: ["oven"] }
      ]
    });
    const context = buildTestContext(
      [],
      [],
      { from: "", to: "" },
      { permissions: { activitiesEnabled: true, alertsEnabled: true } }
    );

    const result = (await explainAlertTool.handler({ alertEventId: "evt-3" }, async () => context)) as {
      relatedActivities: Array<{ tags: string[] }>;
    };

    expect(result.relatedActivities).toHaveLength(1);
    expect(result.relatedActivities[0].tags).toEqual(["geyser"]);
  });

  describe("historical threshold snapshot vs current live configuration", () => {
    function eventFixture(overrides: Record<string, unknown> = {}) {
      return {
        id: "evt-hist",
        type: "monthly_budget",
        title: "Spending is ahead of budget",
        body: "...",
        navigateUrl: "/",
        triggeredAt: "2026-08-01T10:00:00Z",
        triggerValue: 950,
        thresholdValue: 800,
        context: {},
        resolvedAt: null,
        isRead: false,
        ...overrides
      };
    }

    it("reports thresholdChanged: false when the live rule's threshold still matches the historical event", async () => {
      mocks.getAlertEventDetail.mockResolvedValue(eventFixture());
      mocks.getAlertRulesForUser.mockResolvedValue([{ type: "monthly_budget", enabled: true, threshold: 800 }]);
      const context = buildTestContext([], [], { from: "", to: "" });

      const result = (await explainAlertTool.handler({ alertEventId: "evt-hist" }, async () => context)) as {
        thresholdValue: number | null;
        currentThreshold: number | null;
        currentlyEnabled: boolean;
        thresholdChanged: boolean | null;
      };

      expect(result.thresholdValue).toBe(800);
      expect(result.currentThreshold).toBe(800);
      expect(result.currentlyEnabled).toBe(true);
      expect(result.thresholdChanged).toBe(false);
    });

    it("reports thresholdChanged: true when the rule's threshold has since been raised", async () => {
      mocks.getAlertEventDetail.mockResolvedValue(eventFixture());
      mocks.getAlertRulesForUser.mockResolvedValue([{ type: "monthly_budget", enabled: true, threshold: 1300 }]);
      const context = buildTestContext([], [], { from: "", to: "" });

      const result = (await explainAlertTool.handler({ alertEventId: "evt-hist" }, async () => context)) as {
        thresholdValue: number | null;
        currentThreshold: number | null;
        thresholdChanged: boolean | null;
      };

      expect(result.thresholdValue).toBe(800);
      expect(result.currentThreshold).toBe(1300);
      expect(result.thresholdChanged).toBe(true);
    });

    it("reports currentlyEnabled: false when the rule has since been disabled, without losing the historical threshold", async () => {
      mocks.getAlertEventDetail.mockResolvedValue(eventFixture());
      mocks.getAlertRulesForUser.mockResolvedValue([{ type: "monthly_budget", enabled: false, threshold: 800 }]);
      const context = buildTestContext([], [], { from: "", to: "" });

      const result = (await explainAlertTool.handler({ alertEventId: "evt-hist" }, async () => context)) as {
        thresholdValue: number | null;
        currentlyEnabled: boolean;
      };

      expect(result.thresholdValue).toBe(800);
      expect(result.currentlyEnabled).toBe(false);
    });

    it("reports thresholdChanged: null when no live rule exists at all for this type any more", async () => {
      mocks.getAlertEventDetail.mockResolvedValue(eventFixture());
      mocks.getAlertRulesForUser.mockResolvedValue([]);
      const context = buildTestContext([], [], { from: "", to: "" });

      const result = (await explainAlertTool.handler({ alertEventId: "evt-hist" }, async () => context)) as {
        currentThreshold: number | null;
        currentlyEnabled: boolean;
        thresholdChanged: boolean | null;
      };

      expect(result.currentThreshold).toBeNull();
      expect(result.currentlyEnabled).toBe(false);
      expect(result.thresholdChanged).toBeNull();
    });
  });
});
