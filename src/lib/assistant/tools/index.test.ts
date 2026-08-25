import { describe, expect, it, vi } from "vitest";
import { createAssistantToolbox } from "./index";
import type { DailyRollupRow, DashboardSummary, HourlyRollupRow } from "@/lib/types";

const { loadDashboardSummaryMock, loadDashboardDailyRollupsMock, loadDashboardHourlyRollupsMock } = vi.hoisted(() => ({
  loadDashboardSummaryMock: vi.fn<(accessToken: string) => Promise<DashboardSummary>>(),
  loadDashboardDailyRollupsMock: vi.fn<(accessToken: string) => Promise<DailyRollupRow[]>>(),
  loadDashboardHourlyRollupsMock: vi.fn<(accessToken: string) => Promise<HourlyRollupRow[]>>()
}));

vi.mock("@/lib/dashboard-data", () => ({
  loadDashboardSummary: loadDashboardSummaryMock,
  loadDashboardDailyRollups: loadDashboardDailyRollupsMock,
  loadDashboardHourlyRollups: loadDashboardHourlyRollupsMock
}));
vi.mock("@/lib/activity/data", () => ({
  loadActivities: vi.fn().mockResolvedValue([]),
  loadActivityReport: vi.fn().mockResolvedValue({ rows: [], summary: {} })
}));

// The alert tools registered here (get-alert-status.ts etc.) pull in
// @/lib/newinmeter/alerts, which imports @/lib/features (React 19's
// cache(), unavailable from the installed react@18.3.1 outside Next's own
// bundler) -- same shim as alerts.test.ts/connection.test.ts. Registration
// tests below only check tool names/shape, never actually execute a
// handler, so a permissive stub is enough.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("@/lib/features", () => ({
  hasFeatureAccess: vi.fn().mockResolvedValue(true),
  getFeatureAccessForUsers: vi.fn().mockResolvedValue(new Map())
}));

const baseToolNames = [
  "get_scope_overview",
  "get_balance_runout",
  "compare_previous_period",
  "compare_calendar_months",
  "get_top_days",
  "get_top_hours",
  "explain_day",
  "inspect_time_window",
  "get_recent_topups",
  "get_water_overview",
  "get_data_status"
];

const alertToolNames = ["get_alert_status", "get_recent_alerts", "explain_alert", "get_alert_recommendations"];

function toolNames(toolbox: ReturnType<typeof createAssistantToolbox>) {
  return toolbox.tools.map((tool) => tool.name);
}

describe("createAssistantToolbox permission-aware registration", () => {
  it("registers 11 tools, without get_activity_report/find_activities or any alert tool, when Activities and Alerts are both disabled", () => {
    const toolbox = createAssistantToolbox("token", "user-1", {}, { activitiesEnabled: false, alertsEnabled: false });
    const names = toolNames(toolbox);

    expect(names).toHaveLength(11);
    expect(names).not.toContain("get_activity_report");
    expect(names).not.toContain("find_activities");
    for (const name of alertToolNames) {
      expect(names).not.toContain(name);
    }
    for (const name of baseToolNames) {
      expect(names).toContain(name);
    }
    // Every registered tool uses the flat Responses API function-tool
    // shape (no `.function` nesting) and strict mode.
    for (const tool of toolbox.tools) {
      expect(tool.type).toBe("function");
      expect(tool.strict).toBe(true);
      expect(typeof tool.name).toBe("string");
    }
  });

  it("registers 13 tools, including get_activity_report and find_activities, when only Activities is enabled", () => {
    const toolbox = createAssistantToolbox("token", "user-1", {}, { activitiesEnabled: true, alertsEnabled: false });
    const names = toolNames(toolbox);

    expect(names).toHaveLength(13);
    expect(names).toContain("get_activity_report");
    expect(names).toContain("find_activities");
    for (const name of alertToolNames) {
      expect(names).not.toContain(name);
    }
  });

  it("registers 15 tools, including all 4 alert tools, when only Alerts is enabled", () => {
    const toolbox = createAssistantToolbox("token", "user-1", {}, { activitiesEnabled: false, alertsEnabled: true });
    const names = toolNames(toolbox);

    expect(names).toHaveLength(15);
    expect(names).not.toContain("get_activity_report");
    expect(names).not.toContain("find_activities");
    for (const name of alertToolNames) {
      expect(names).toContain(name);
    }
  });

  it("registers all 17 tools when both Activities and Alerts are enabled", () => {
    const toolbox = createAssistantToolbox("token", "user-1", {}, { activitiesEnabled: true, alertsEnabled: true });
    const names = toolNames(toolbox);

    expect(names).toHaveLength(17);
  });

  it("rejects a call to get_activity_report when Activities are disabled, as an unknown tool", async () => {
    const toolbox = createAssistantToolbox("token", "user-1", {}, { activitiesEnabled: false, alertsEnabled: false });

    await expect(toolbox.execute("get_activity_report", {})).rejects.toThrow("Unknown assistant tool");
  });

  it("rejects a call to any alert tool when Alerts are disabled, as an unknown tool", async () => {
    const toolbox = createAssistantToolbox("token", "user-1", {}, { activitiesEnabled: false, alertsEnabled: false });

    await expect(toolbox.execute("get_alert_status", {})).rejects.toThrow("Unknown assistant tool");
    await expect(toolbox.execute("explain_alert", { alertEventId: "x" })).rejects.toThrow("Unknown assistant tool");
  });
});

describe("createAssistantToolbox shared dashboard context under concurrent execution", () => {
  it("loads dashboard summary/daily/hourly data only once, even when multiple tools execute concurrently, and threads userId/permissions into context", async () => {
    loadDashboardSummaryMock.mockReset().mockResolvedValue({ dateStart: "2026-07-01", dateEnd: "2026-07-31" });
    loadDashboardDailyRollupsMock.mockReset().mockResolvedValue([]);
    loadDashboardHourlyRollupsMock.mockReset().mockResolvedValue([]);

    const toolbox = createAssistantToolbox("token", "user-42", {}, { activitiesEnabled: false, alertsEnabled: false });

    // Mirrors how openai.ts's Promise.all fires several tool calls from one
    // assistant turn concurrently -- getContext()'s memoized promise must
    // still resolve to a single underlying fetch, not one per call.
    const [overview] = await Promise.all([
      toolbox.execute("get_scope_overview", {}),
      toolbox.execute("get_balance_runout", {}),
      toolbox.execute("compare_previous_period", {})
    ]);

    expect(loadDashboardSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadDashboardDailyRollupsMock).toHaveBeenCalledTimes(1);
    expect(loadDashboardHourlyRollupsMock).toHaveBeenCalledTimes(1);
    expect(overview).toMatchObject({ scope: { from: "2026-07-01", to: "2026-07-31" } });
  });
});

describe("createAssistantToolbox base context", () => {
  it("does not load dashboard analytics for find_activities", async () => {
    loadDashboardSummaryMock.mockReset();
    loadDashboardDailyRollupsMock.mockReset();
    loadDashboardHourlyRollupsMock.mockReset();

    const toolbox = createAssistantToolbox(
      "token",
      "user-42",
      { from: "2026-08-24", to: "2026-08-24" },
      { activitiesEnabled: true, alertsEnabled: false }
    );
    await toolbox.execute("find_activities", {
      from: "2026-08-24",
      to: "2026-08-24",
      tag: null,
      startTime: null,
      endTime: null
    });

    expect(loadDashboardSummaryMock).not.toHaveBeenCalled();
    expect(loadDashboardDailyRollupsMock).not.toHaveBeenCalled();
    expect(loadDashboardHourlyRollupsMock).not.toHaveBeenCalled();
  });
});
