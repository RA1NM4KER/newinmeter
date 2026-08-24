import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminSupabaseFetch: vi.fn(),
  adminSupabaseRequest: vi.fn(),
  adminSupabaseCount: vi.fn(),
  sendPushToUser: vi.fn(),
  getConnectionRowForUser: vi.fn(),
  setAutoSyncEnabled: vi.fn(),
  hasFeatureAccess: vi.fn(),
  getFeatureAccessForUsers: vi.fn()
}));

vi.mock("../supabase-rest", () => ({
  adminSupabaseFetch: mocks.adminSupabaseFetch,
  adminSupabaseRequest: mocks.adminSupabaseRequest,
  adminSupabaseCount: mocks.adminSupabaseCount
}));
vi.mock("../push-notify", () => ({ sendPushToUser: mocks.sendPushToUser }));
// Alerts gating (hasFeatureAccess/getFeatureAccessForUsers) is its own
// module with its own tests (features.test.ts) -- everything in this file
// is testing evaluateAlertsAfterSync/evaluateDataDelayedAlerts's own alert
// logic, so the gate defaults to "access granted" here. The one test that
// cares about the gate itself (see "Alerts feature gating" below) overrides
// this per-call.
mocks.hasFeatureAccess.mockResolvedValue(true);
mocks.getFeatureAccessForUsers.mockImplementation(async (userIds: string[]) =>
  new Map(userIds.map((userId) => [userId, { alerts: { enabled: true, source: "rollout" as const } }]))
);
vi.mock("../features", () => ({
  hasFeatureAccess: mocks.hasFeatureAccess,
  getFeatureAccessForUsers: mocks.getFeatureAccessForUsers
}));
// Same react cache() shim as connection.test.ts -- this file imports the
// real connection.ts (for getConnectionRowForUser's mock shape / the
// DemoAccountProtectedError class), whose getConnectionForUser uses React
// 19's cache(), unavailable in the installed react@18.3.1 outside Next's
// own bundler.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("./connection", async () => {
  const actual = await vi.importActual<typeof import("./connection")>("./connection");
  return {
    ...actual,
    getConnectionRowForUser: mocks.getConnectionRowForUser,
    setAutoSyncEnabled: mocks.setAutoSyncEnabled
  };
});

import {
  AlertRuleValidationError,
  AutoSyncRequiredError,
  DATA_DELAYED_AFTER_HOURS,
  disableFreshDataAlertRules,
  evaluateAlertsAfterSync,
  evaluateDataDelayedAlerts,
  getAlertInsights,
  getRecentNotifications,
  getUnreadNotificationCount,
  hasAnyEnabledAlertRule,
  markAllNotificationsRead,
  markNotificationRead,
  resolveOverlappingUsageAnomalyEvents,
  upsertAlertRule,
  validateThreshold
} from "./alerts";
import { DemoAccountProtectedError } from "./connection";
import { formatCurrency, formatTariff } from "../format";
import { currentLocalDateString } from "./schedule";

const TODAY = currentLocalDateString(new Date());

function shiftDate(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

// Mirrors alerts.ts's own private isWeekendDate exactly -- calendar-date-only
// comparison, safe regardless of the runner's actual timezone.
function isWeekendTestDate(dateString: string): boolean {
  const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

const baseConnectionRow = {
  id: "conn-1",
  user_id: "user-1",
  is_demo: false,
  auto_sync_enabled: true,
  status: "connected"
};

function ruleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rule-1",
    connection_id: "conn-1",
    type: "low_balance",
    enabled: true,
    threshold: 200,
    updated_at: "2026-08-24T00:00:00.000Z",
    ...overrides
  };
}

describe("validateThreshold", () => {
  it("rejects a threshold for data_delayed", () => {
    expect(validateThreshold("data_delayed", 1)).not.toBeNull();
    expect(validateThreshold("data_delayed", null)).toBeNull();
  });

  it("rejects a null or non-positive threshold for the other types", () => {
    expect(validateThreshold("low_balance", null)).not.toBeNull();
    expect(validateThreshold("low_balance", 0)).not.toBeNull();
    expect(validateThreshold("daily_spend", -5)).not.toBeNull();
  });

  it("rejects a threshold above the type's upper bound", () => {
    expect(validateThreshold("daily_kwh", 20000)).not.toBeNull();
  });

  it("accepts a valid threshold", () => {
    expect(validateThreshold("low_balance", 200)).toBeNull();
    expect(validateThreshold("daily_kwh", 10)).toBeNull();
  });
});

describe("upsertAlertRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionRowForUser.mockResolvedValue(baseConnectionRow);
  });

  it("creates/updates a rule scoped to the caller's own connection", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([ruleRow({ enabled: true, threshold: 250 })]);

    const result = await upsertAlertRule({ userId: "user-1", type: "low_balance", enabled: true, threshold: 250 });

    expect(mocks.getConnectionRowForUser).toHaveBeenCalledWith("user-1");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_rules?on_conflict=connection_id,type",
      expect.objectContaining({ connection_id: "conn-1", type: "low_balance", enabled: true, threshold: 250 }),
      "resolution=merge-duplicates,return=representation"
    );
    expect(result.rule.threshold).toBe(250);
  });

  it("disables a rule without requiring a threshold change, and clears any evaluator state it was carrying", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([ruleRow({ id: "rule-1", enabled: false })]);

    const result = await upsertAlertRule({ userId: "user-1", type: "low_balance", enabled: false, threshold: 200 });

    expect(result.rule.enabled).toBe(false);
    // See clearAlertRuleState's own comment -- a DELETE with no matching
    // row (low_balance never uses alert_rule_state) is a harmless no-op,
    // so this fires unconditionally on every disable rather than special-
    // casing tariff_changed by name.
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "DELETE",
      `/alert_rule_state?alert_rule_id=eq.rule-1`,
      undefined,
      "return=minimal"
    );
  });

  it("rejects an invalid threshold before ever writing", async () => {
    await expect(
      upsertAlertRule({ userId: "user-1", type: "daily_spend", enabled: true, threshold: -10 })
    ).rejects.toBeInstanceOf(AlertRuleValidationError);
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("only ever resolves the connection for the authenticated caller's own userId -- there is no other way to target a connection", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([ruleRow()]);
    await upsertAlertRule({ userId: "some-other-user", type: "low_balance", enabled: true, threshold: 200 });
    expect(mocks.getConnectionRowForUser).toHaveBeenCalledWith("some-other-user");
    // The written row is always the id getConnectionRowForUser resolved,
    // never anything the caller could otherwise influence.
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      expect.any(String),
      expect.objectContaining({ connection_id: baseConnectionRow.id }),
      expect.any(String)
    );
  });

  it("throws AutoSyncRequiredError enabling a fresh-data alert with auto-sync off and no confirmation", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue({ ...baseConnectionRow, auto_sync_enabled: false });
    await expect(
      upsertAlertRule({ userId: "user-1", type: "daily_spend", enabled: true, threshold: 50 })
    ).rejects.toBeInstanceOf(AutoSyncRequiredError);
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("turns auto-sync on as part of the same confirmed action and returns the freshly computed next_sync_at", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue({ ...baseConnectionRow, auto_sync_enabled: false, next_sync_at: null });
    mocks.setAutoSyncEnabled.mockResolvedValue({
      id: "conn-1",
      autoSyncEnabled: true,
      nextSyncAt: "2026-08-25T03:15:00.000Z"
    });
    mocks.adminSupabaseRequest.mockResolvedValue([ruleRow({ type: "daily_spend", threshold: 50 })]);

    const result = await upsertAlertRule({
      userId: "user-1",
      type: "daily_spend",
      enabled: true,
      threshold: 50,
      alsoEnableAutoSync: true
    });

    expect(mocks.setAutoSyncEnabled).toHaveBeenCalledWith("user-1", true);
    expect(result.autoSyncEnabled).toBe(true);
    expect(result.nextSyncAt).toBe("2026-08-25T03:15:00.000Z");
  });

  it("carries through the connection's existing next_sync_at when auto-sync was already on", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue({
      ...baseConnectionRow,
      auto_sync_enabled: true,
      next_sync_at: "2026-08-24T18:15:00.000Z"
    });
    mocks.adminSupabaseRequest.mockResolvedValue([ruleRow({ threshold: 300 })]);

    const result = await upsertAlertRule({ userId: "user-1", type: "low_balance", enabled: true, threshold: 300 });

    expect(mocks.setAutoSyncEnabled).not.toHaveBeenCalled();
    expect(result.nextSyncAt).toBe("2026-08-24T18:15:00.000Z");
  });

  it("never requires auto-sync for data_delayed", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue({ ...baseConnectionRow, auto_sync_enabled: false });
    mocks.adminSupabaseRequest.mockResolvedValue([ruleRow({ type: "data_delayed", threshold: null })]);

    await expect(
      upsertAlertRule({ userId: "user-1", type: "data_delayed", enabled: true, threshold: null })
    ).resolves.toBeDefined();
    expect(mocks.setAutoSyncEnabled).not.toHaveBeenCalled();
  });

  it("refuses to configure alerts for a demo connection", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue({ ...baseConnectionRow, is_demo: true });
    await expect(
      upsertAlertRule({ userId: "user-1", type: "low_balance", enabled: true, threshold: 200 })
    ).rejects.toBeInstanceOf(DemoAccountProtectedError);
  });
});

// Shared fetch router for evaluateAlertsAfterSync scenarios: branches on the
// PostgREST path so one mock can serve every query the evaluator makes.
function routeFetch(responses: {
  rules?: unknown[];
  balance?: number | null;
  todayRollup?: { total_spend: number; energy_kwh: number } | null;
  activeEvent?: { id: string } | null;
  dataDelayedRule?: unknown | null;
}) {
  mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
    if (path.includes("/alert_rules") && path.includes("type=in.(")) {
      return responses.rules ?? [];
    }
    if (path.includes("/alert_rules") && path.includes("type=eq.data_delayed")) {
      return responses.dataDelayedRule ? [responses.dataDelayedRule] : [];
    }
    if (path.includes("/dashboard_summary")) {
      return responses.balance === undefined ? [] : [{ latest_balance: responses.balance }];
    }
    if (path.includes("/energy_day_rollups")) {
      return responses.todayRollup
        ? [{ period_date: TODAY, is_complete: true, ...responses.todayRollup }]
        : [];
    }
    if (path.includes("/alert_events")) {
      return responses.activeEvent ? [responses.activeEvent] : [];
    }
    throw new Error(`unexpected fetch path in test: ${path}`);
  });
}

describe("evaluateAlertsAfterSync -- low balance (active-event dedup)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-1" }]);
  });

  it("above threshold: no event, no push", async () => {
    routeFetch({ rules: [ruleRow({ threshold: 200 })], balance: 500, dataDelayedRule: null });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("crossing below: creates an event and sends a push", async () => {
    routeFetch({ rules: [ruleRow({ threshold: 200 })], balance: 150, activeEvent: null, dataDelayedRule: null });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({ alert_rule_id: "rule-1", connection_id: "conn-1", trigger_value: 150 }),
      "return=representation"
    );
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ title: "Low balance" })
    );
  });

  it("staying below with an already-active event: no duplicate notification", async () => {
    routeFetch({
      rules: [ruleRow({ threshold: 200 })],
      balance: 140,
      activeEvent: { id: "event-existing" },
      dataDelayedRule: null
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalledWith("POST", "/alert_events", expect.anything(), expect.anything());
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("resolving above threshold: resolves the active event, no push", async () => {
    routeFetch({
      rules: [ruleRow({ threshold: 200 })],
      balance: 400,
      activeEvent: { id: "event-existing" },
      dataDelayedRule: null
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      expect.stringContaining("event-existing"),
      expect.objectContaining({ resolved_at: expect.any(String) }),
      "return=minimal"
    );
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });
});

describe("evaluateAlertsAfterSync -- daily spend / daily kWh (date-scoped dedup)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
  });

  it("under threshold: no event", async () => {
    routeFetch({
      rules: [ruleRow({ id: "rule-spend", type: "daily_spend", threshold: 50 })],
      todayRollup: { total_spend: 20, energy_kwh: 0 },
      dataDelayedRule: null
    });
    mocks.adminSupabaseRequest.mockResolvedValue([]);
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("above threshold: creates an event and notifies", async () => {
    routeFetch({
      rules: [ruleRow({ id: "rule-spend", type: "daily_spend", threshold: 50 })],
      todayRollup: { total_spend: 80, energy_kwh: 0 },
      dataDelayedRule: null
    });
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-spend-1" }]);
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({ alert_rule_id: "rule-spend", trigger_value: 80, period_date: expect.any(String) }),
      "return=representation"
    );
    expect(mocks.sendPushToUser).toHaveBeenCalledOnce();
  });

  it("a repeated sync the same day is deduped by the unique (rule, day) index, not a duplicate push", async () => {
    routeFetch({
      rules: [ruleRow({ id: "rule-spend", type: "daily_spend", threshold: 50 })],
      todayRollup: { total_spend: 80, energy_kwh: 0 },
      dataDelayedRule: null
    });
    mocks.adminSupabaseRequest.mockRejectedValue(new Error('duplicate key value violates unique constraint "alert_events_one_per_rule_per_day_idx" (23505)'));
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("daily kWh mirrors the same semantics", async () => {
    routeFetch({
      rules: [ruleRow({ id: "rule-kwh", type: "daily_kwh", threshold: 10 })],
      todayRollup: { total_spend: 0, energy_kwh: 12.5 },
      dataDelayedRule: null
    });
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-kwh-1" }]);
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.sendPushToUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ title: "Electricity usage alert" }));
  });
});

describe("evaluateAlertsAfterSync -- resolves data_delayed on any successful sync", () => {
  it("resolves an active data_delayed event even when no fresh-data alert is enabled", async () => {
    routeFetch({ rules: [], dataDelayedRule: ruleRow({ id: "rule-delayed", type: "data_delayed", threshold: null }), activeEvent: { id: "event-delayed" } });
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      expect.stringContaining("event-delayed"),
      expect.objectContaining({ resolved_at: expect.any(String) }),
      "return=minimal"
    );
  });

  it("never throws even if a query fails -- an evaluation failure must not affect the sync result", async () => {
    mocks.adminSupabaseFetch.mockRejectedValue(new Error("boom"));
    await expect(evaluateAlertsAfterSync("conn-1", "user-1")).resolves.toBeUndefined();
  });
});

describe("evaluateDataDelayedAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
  });

  it("does not notify for a connection within the threshold (one ordinary missed run)", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([ruleRow({ id: "rule-a", connection_id: "conn-a", type: "data_delayed", threshold: null })]);
    const sevenHoursAgo = new Date(Date.now() - 7 * 3_600_000).toISOString();

    const result = await evaluateDataDelayedAlerts([{ connectionId: "conn-a", userId: "user-a", lastSyncedAt: sevenHoursAgo }]);

    expect(result.notified).toBe(0);
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("notifies once a connection is stale past DATA_DELAYED_AFTER_HOURS", async () => {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("type=eq.data_delayed")) {
        return [ruleRow({ id: "rule-a", connection_id: "conn-a", type: "data_delayed", threshold: null })];
      }
      if (path.includes("/alert_events")) {
        return [];
      }
      throw new Error(`unexpected path: ${path}`);
    });
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-a" }]);
    const staleAgo = new Date(Date.now() - (DATA_DELAYED_AFTER_HOURS + 1) * 3_600_000).toISOString();

    const result = await evaluateDataDelayedAlerts([{ connectionId: "conn-a", userId: "user-a", lastSyncedAt: staleAgo }]);

    expect(result.notified).toBe(1);
    expect(mocks.sendPushToUser).toHaveBeenCalledWith("user-a", expect.objectContaining({ title: "Meter data delayed" }));
  });

  it("does not send a duplicate while an event is already active", async () => {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("type=eq.data_delayed")) {
        return [ruleRow({ id: "rule-a", connection_id: "conn-a", type: "data_delayed", threshold: null })];
      }
      if (path.includes("/alert_events")) {
        return [{ id: "event-already-active" }];
      }
      throw new Error(`unexpected path: ${path}`);
    });
    const staleAgo = new Date(Date.now() - (DATA_DELAYED_AFTER_HOURS + 5) * 3_600_000).toISOString();

    const result = await evaluateDataDelayedAlerts([{ connectionId: "conn-a", userId: "user-a", lastSyncedAt: staleAgo }]);

    expect(result.notified).toBe(0);
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });
});

function routeEventFetch(rules: Array<{ id: string; type: string }>, events: unknown[]) {
  mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
    if (path.includes("/alert_rules")) return rules;
    if (path.includes("/alert_events")) return events;
    throw new Error(`unexpected fetch path in test: ${path}`);
  });
}

describe("getRecentNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionRowForUser.mockResolvedValue({ id: "conn-1", user_id: "user-1" });
  });

  it("returns an empty list when the user has no connection", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue(null);
    const result = await getRecentNotifications("user-1");
    expect(result).toEqual([]);
    expect(mocks.adminSupabaseFetch).not.toHaveBeenCalled();
  });

  it("scopes both queries to the resolved connection and passes the limit through", async () => {
    routeEventFetch([{ id: "rule-1", type: "low_balance" }], []);
    await getRecentNotifications("user-1", 10);

    const calledPaths = mocks.adminSupabaseFetch.mock.calls.map((call) => call[0] as string);
    expect(calledPaths.some((p) => p.includes("/alert_rules") && p.includes("connection_id=eq.conn-1"))).toBe(true);
    expect(
      calledPaths.some(
        (p) => p.includes("/alert_events") && p.includes("connection_id=eq.conn-1") && p.includes("limit=10")
      )
    ).toBe(true);
    expect(calledPaths.some((p) => p.includes("order=triggered_at.desc"))).toBe(true);
  });

  it("includes resolved historical events and reports correct read state", async () => {
    routeEventFetch(
      [{ id: "rule-1", type: "low_balance" }],
      [
        {
          id: "event-unread",
          alert_rule_id: "rule-1",
          triggered_at: "2026-08-24T01:00:00.000Z",
          trigger_value: 100,
          threshold_value: 200,
          read_at: null
        },
        {
          id: "event-read-and-resolved",
          alert_rule_id: "rule-1",
          triggered_at: "2026-08-23T01:00:00.000Z",
          trigger_value: 250,
          threshold_value: 200,
          read_at: "2026-08-23T02:00:00.000Z"
        }
      ]
    );

    const result = await getRecentNotifications("user-1");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "event-unread", isRead: false, type: "low_balance" });
    expect(result[1]).toMatchObject({ id: "event-read-and-resolved", isRead: true });
    expect(result[1].title).toBe("Low balance");
  });

  it("uses the event's own snapshotted threshold, not any current rule value", async () => {
    routeEventFetch(
      [{ id: "rule-1", type: "daily_spend" }],
      [
        {
          id: "event-1",
          alert_rule_id: "rule-1",
          triggered_at: "2026-08-24T01:00:00.000Z",
          trigger_value: 54.8,
          threshold_value: 50,
          read_at: null
        }
      ]
    );

    const [item] = await getRecentNotifications("user-1");
    // en-ZA currency formatting (formatCurrency) -- "R 50,00" style, not
    // "R50.00". The point of this test is that it's 50 (the snapshotted
    // threshold_value), not any different current rule.threshold.
    expect(item.body).toContain(formatCurrency(50));
    expect(item.body).toContain(formatCurrency(54.8));
  });
});

describe("getUnreadNotificationCount", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 0 when the user has no connection", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue(null);
    await expect(getUnreadNotificationCount("user-1")).resolves.toBe(0);
    expect(mocks.adminSupabaseCount).not.toHaveBeenCalled();
  });

  it("counts only this connection's unread events", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue({ id: "conn-1" });
    mocks.adminSupabaseCount.mockResolvedValue(3);

    await expect(getUnreadNotificationCount("user-1")).resolves.toBe(3);
    expect(mocks.adminSupabaseCount).toHaveBeenCalledWith(
      expect.stringContaining("connection_id=eq.conn-1")
    );
    expect(mocks.adminSupabaseCount).toHaveBeenCalledWith(expect.stringContaining("read_at=is.null"));
  });
});

describe("hasAnyEnabledAlertRule", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns false when the user has no connection", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue(null);
    await expect(hasAnyEnabledAlertRule("user-1")).resolves.toBe(false);
    expect(mocks.adminSupabaseCount).not.toHaveBeenCalled();
  });

  it("returns false when the connection has zero enabled rules", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue({ id: "conn-1" });
    mocks.adminSupabaseCount.mockResolvedValue(0);

    await expect(hasAnyEnabledAlertRule("user-1")).resolves.toBe(false);
    expect(mocks.adminSupabaseCount).toHaveBeenCalledWith(expect.stringContaining("connection_id=eq.conn-1"));
    expect(mocks.adminSupabaseCount).toHaveBeenCalledWith(expect.stringContaining("enabled=eq.true"));
  });

  it("returns true when at least one rule is enabled", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue({ id: "conn-1" });
    mocks.adminSupabaseCount.mockResolvedValue(2);

    await expect(hasAnyEnabledAlertRule("user-1")).resolves.toBe(true);
  });
});

describe("markNotificationRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionRowForUser.mockResolvedValue({ id: "conn-1" });
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);
  });

  it("marks an unread event read, scoped to the resolved connection and only that field", async () => {
    await markNotificationRead("user-1", "event-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      expect.stringMatching(/id=eq\.event-1.*connection_id=eq\.conn-1.*read_at=is\.null/),
      { read_at: expect.any(String) },
      "return=minimal"
    );
  });

  it("does not touch any system field (trigger_value, threshold_value, resolved_at, connection_id, alert_rule_id)", async () => {
    await markNotificationRead("user-1", "event-1");
    const [, , body] = mocks.adminSupabaseRequest.mock.calls[0];
    expect(Object.keys(body)).toEqual(["read_at"]);
  });

  it("is idempotent -- calling it again on an already-read event is a no-op, not an error", async () => {
    await markNotificationRead("user-1", "event-1");
    await expect(markNotificationRead("user-1", "event-1")).resolves.toBeUndefined();
  });

  it("cannot mark another user's event -- ownership always comes from the resolved connection, never the event id", async () => {
    // "user-1" only ever resolves to conn-1 in this test; the PATCH is
    // always scoped to that connection_id regardless of which event id is
    // passed, so an id belonging to another user's connection matches zero
    // rows server-side rather than this code ever targeting it directly.
    await markNotificationRead("user-1", "someone-elses-event-id");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      expect.stringContaining("connection_id=eq.conn-1"),
      expect.anything(),
      expect.anything()
    );
  });

  it("does nothing when the user has no connection", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue(null);
    await markNotificationRead("user-1", "event-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });
});

describe("markAllNotificationsRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionRowForUser.mockResolvedValue({ id: "conn-1" });
  });

  it("marks all of this connection's unread events and returns how many", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);

    await expect(markAllNotificationsRead("user-1")).resolves.toBe(2);
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      expect.stringMatching(/connection_id=eq\.conn-1.*read_at=is\.null/),
      { read_at: expect.any(String) },
      "return=representation"
    );
  });

  it("is idempotent -- returns 0 when nothing is unread", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([]);
    await expect(markAllNotificationsRead("user-1")).resolves.toBe(0);
  });

  it("does nothing when the user has no connection", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue(null);
    await expect(markAllNotificationsRead("user-1")).resolves.toBe(0);
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Alerts v2
// ---------------------------------------------------------------------------

// A more general router than routeFetch above -- v2 families touch several
// extra tables (energy_rows, livemopay_connections, energy_hourly_rollups,
// usage_activities) that the v1-only router above never needed to know
// about. `rollupRows` is passed through untouched (not filtered by date) --
// each test builds exactly the rows its scenario needs.
// Mirrors PostgREST's own period_date=gte./lte./lt. filtering -- without
// this, a mock that just returns `opts.rollupRows` unconditionally can
// never catch a bug in the *query string's own date bounds* (exactly the
// class of bug that hid the since-window inversion this file's own
// "month-to-date window" tests below exist to catch).
function filterByPeriodDateRange<T extends { period_date: string }>(path: string, rows: T[]): T[] {
  const gte = path.match(/period_date=gte\.([^&]+)/)?.[1];
  const lte = path.match(/period_date=lte\.([^&]+)/)?.[1];
  const lt = path.match(/period_date=lt\.([^&]+)/)?.[1];
  return rows.filter((row) => {
    if (gte && row.period_date < gte) return false;
    if (lte && row.period_date > lte) return false;
    if (lt && row.period_date >= lt) return false;
    return true;
  });
}

function routeFetchV2(opts: {
  rules: unknown[];
  balance?: number | null;
  rollupRows?: unknown[];
  activeEvent?: { id: string } | null;
  ruleState?: { lastObservedTariff?: number } | null;
  latestTariff?: number | null;
  tariffProfile?: string | null;
  hourlyRows?: unknown[];
  activities?: unknown[];
}) {
  mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
    if (path.includes("/alert_rules") && path.includes("type=eq.data_delayed")) {
      return [];
    }
    if (path.includes("/alert_rules") && path.includes("type=in.(")) {
      return opts.rules;
    }
    if (path.includes("/dashboard_summary")) {
      return opts.balance === undefined ? [] : [{ latest_balance: opts.balance }];
    }
    if (path.includes("/energy_day_rollups")) {
      return filterByPeriodDateRange(path, (opts.rollupRows ?? []) as Array<{ period_date: string }>);
    }
    if (path.includes("/alert_rule_state")) {
      return opts.ruleState === undefined || opts.ruleState === null ? [] : [{ state: opts.ruleState }];
    }
    if (path.includes("/energy_rows")) {
      return opts.latestTariff == null ? [] : [{ tariff: opts.latestTariff }];
    }
    if (path.includes("/livemopay_connections")) {
      return [{ tariff_profile: opts.tariffProfile ?? null }];
    }
    if (path.includes("/energy_hourly_rollups")) {
      return filterByPeriodDateRange(path, (opts.hourlyRows ?? []) as Array<{ period_date: string }>);
    }
    if (path.includes("/usage_activities")) {
      return opts.activities ?? [];
    }
    if (path.includes("/alert_events")) {
      return opts.activeEvent ? [opts.activeEvent] : [];
    }
    throw new Error(`unexpected fetch path in v2 test: ${path}`);
  });
}

function recentCompleteDayRows(dailySpends: number[]): Array<Record<string, unknown>> {
  return dailySpends.map((spend, index) => ({
    period_date: shiftDate(TODAY, -(index + 1)),
    total_spend: spend,
    energy_kwh: 0,
    is_complete: true
  }));
}

describe("evaluateAlertsAfterSync -- balance_runway (predictive, hysteresis)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-runway-1" }]);
  });

  it("insufficient history (fewer than 5 complete days): no event, no push", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-runway", type: "balance_runway", threshold: 3 })],
      balance: 100,
      rollupRows: recentCompleteDayRows([50, 50, 50])
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("estimate at/below threshold: creates an event with a rounded, natural-language push", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-runway", type: "balance_runway", threshold: 3 })],
      balance: 140,
      rollupRows: recentCompleteDayRows([50, 50, 50, 50, 50, 50, 50]),
      activeEvent: null
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({
        alert_rule_id: "rule-runway",
        event_context: { balance: 140, averageDailySpend: 50, estimatedDaysRemaining: 2.8 }
      }),
      "return=representation"
    );
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        title: "Balance running out soon",
        body: expect.stringContaining("about 3 days")
      })
    );
  });

  it("hysteresis: an open event stays open between the threshold and threshold+1 (no flapping)", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-runway", type: "balance_runway", threshold: 3 })],
      balance: 175,
      rollupRows: recentCompleteDayRows([50, 50, 50, 50, 50, 50, 50]), // estimate = 3.5
      activeEvent: { id: "event-existing" }
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("hysteresis: resolves once the estimate clears threshold+1", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-runway", type: "balance_runway", threshold: 3 })],
      balance: 225,
      rollupRows: recentCompleteDayRows([50, 50, 50, 50, 50, 50, 50]), // estimate = 4.5
      activeEvent: { id: "event-existing" }
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      expect.stringContaining("event-existing"),
      expect.objectContaining({ resolved_at: expect.any(String) }),
      "return=minimal"
    );
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("correlation suppression: balance_runway's push wins over low_balance's when both cross in the same cycle, and low_balance's row is written suppressed", async () => {
    routeFetchV2({
      rules: [
        ruleRow({ id: "rule-low-balance", type: "low_balance", threshold: 200 }),
        ruleRow({ id: "rule-runway", type: "balance_runway", threshold: 3 })
      ],
      balance: 140,
      rollupRows: recentCompleteDayRows([50, 50, 50, 50, 50, 50, 50]),
      activeEvent: null
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    const createdEvents = mocks.adminSupabaseRequest.mock.calls.filter(
      (call) => call[0] === "POST" && call[1] === "/alert_events"
    );
    expect(createdEvents).toHaveLength(2);
    // Only the more informative predictive alert (balance_runway) sends a
    // push -- low_balance's own event is still created (so it doesn't nag
    // again next sync), just silently, and is written suppressed: true so
    // the Notification Centre never lists it as a second, near-duplicate
    // bell entry.
    const runwayEvent = createdEvents.find((call) => (call[2] as Record<string, unknown>).alert_rule_id === "rule-runway");
    const lowBalanceEvent = createdEvents.find(
      (call) => (call[2] as Record<string, unknown>).alert_rule_id === "rule-low-balance"
    );
    expect(runwayEvent?.[2]).toMatchObject({ suppressed: false });
    expect(lowBalanceEvent?.[2]).toMatchObject({ suppressed: true });
    expect(mocks.sendPushToUser).toHaveBeenCalledOnce();
    expect(mocks.sendPushToUser).toHaveBeenCalledWith("user-1", expect.objectContaining({ title: "Balance running out soon" }));
  });

  it("correlation suppression: the suppressed low_balance sibling does not fire again on the next sync (active-event dedup untouched)", async () => {
    // Second sync: balance_runway's event is now active (resolved_at is
    // null), and so is low_balance's own suppressed event -- both dedup
    // exactly as any other active event would, independent of `suppressed`.
    routeFetchV2({
      rules: [
        ruleRow({ id: "rule-low-balance", type: "low_balance", threshold: 200 }),
        ruleRow({ id: "rule-runway", type: "balance_runway", threshold: 3 })
      ],
      balance: 140,
      rollupRows: recentCompleteDayRows([50, 50, 50, 50, 50, 50, 50]),
      activeEvent: { id: "event-existing" }
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });
});

describe("correlation suppression -- monthly_budget / daily_spend pair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-1" }]);
  });

  it("monthly_budget's push wins over daily_spend's when both cross in the same cycle, and daily_spend's row is written suppressed", async () => {
    routeFetchV2({
      rules: [
        ruleRow({ id: "rule-daily-spend", type: "daily_spend", threshold: 50 }),
        ruleRow({ id: "rule-budget", type: "monthly_budget", threshold: 1500 })
      ],
      balance: 1000,
      rollupRows: [
        ...recentCompleteDayRows([130, 130, 130, 130, 130, 130, 130]),
        { period_date: TODAY, total_spend: 80, energy_kwh: 0, is_complete: false }
      ]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    const createdEvents = mocks.adminSupabaseRequest.mock.calls.filter(
      (call) => call[0] === "POST" && call[1] === "/alert_events"
    );
    expect(createdEvents).toHaveLength(2);
    const budgetEvent = createdEvents.find((call) => (call[2] as Record<string, unknown>).alert_rule_id === "rule-budget");
    const spendEvent = createdEvents.find(
      (call) => (call[2] as Record<string, unknown>).alert_rule_id === "rule-daily-spend"
    );
    expect(budgetEvent?.[2]).toMatchObject({ suppressed: false });
    expect(spendEvent?.[2]).toMatchObject({ suppressed: true });
    expect(mocks.sendPushToUser).toHaveBeenCalledOnce();
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ title: "Spending is ahead of budget" })
    );
  });

  it("the suppressed daily_spend sibling does not fire again on the next sync (period_date dedup untouched)", async () => {
    routeFetchV2({
      rules: [
        ruleRow({ id: "rule-daily-spend", type: "daily_spend", threshold: 50 }),
        ruleRow({ id: "rule-budget", type: "monthly_budget", threshold: 1500 })
      ],
      balance: 1000,
      rollupRows: [
        ...recentCompleteDayRows([130, 130, 130, 130, 130, 130, 130]),
        { period_date: TODAY, total_spend: 80, energy_kwh: 0, is_complete: false }
      ]
    });
    mocks.adminSupabaseRequest.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "alert_events_one_per_rule_per_dedup_key_idx" (23505)')
    );
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });
});

describe("Notification Centre visibility -- suppressed events never appear", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionRowForUser.mockResolvedValue({ id: "conn-1" });
  });

  it("getRecentNotifications filters suppressed rows out server-side, so one condition cluster shows exactly one item", async () => {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("/alert_rules")) {
        return [
          { id: "rule-runway", type: "balance_runway" },
          { id: "rule-low-balance", type: "low_balance" }
        ];
      }
      if (path.includes("/alert_events")) {
        expect(path).toContain("suppressed=eq.false");
        // Simulates what the real suppressed=eq.false filter already
        // excluded -- only the visible (non-suppressed) event comes back.
        return [
          {
            id: "event-runway-1",
            alert_rule_id: "rule-runway",
            triggered_at: "2026-08-24T06:00:00.000Z",
            trigger_value: 2.8,
            threshold_value: 3,
            read_at: null,
            event_context: { balance: 140, averageDailySpend: 50, estimatedDaysRemaining: 2.8 }
          }
        ];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const notifications = await getRecentNotifications("user-1");
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("Balance running out soon");
  });

  it("getUnreadNotificationCount excludes suppressed rows from the badge count", async () => {
    mocks.adminSupabaseCount.mockResolvedValue(1);
    await getUnreadNotificationCount("user-1");
    expect(mocks.adminSupabaseCount).toHaveBeenCalledWith(expect.stringContaining("suppressed=eq.false"));
  });

  it("markAllNotificationsRead never marks a suppressed row (it was never visible to mark)", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([]);
    await markAllNotificationsRead("user-1");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      expect.stringContaining("suppressed=eq.false"),
      expect.any(Object),
      "return=representation"
    );
  });
});

describe("evaluateAlertsAfterSync -- monthly_budget (predictive pacing, month-scoped dedup)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-budget-1" }]);
  });

  it("projects month-end spend from month-to-date + recent daily rate, and notifies once when over budget", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-budget", type: "monthly_budget", threshold: 1500 })],
      balance: 1000,
      rollupRows: recentCompleteDayRows([130, 130, 130, 130, 130, 130, 130])
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({
        alert_rule_id: "rule-budget",
        dedup_key: TODAY.slice(0, 7)
      }),
      "return=representation"
    );
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ title: "Spending is ahead of budget" })
    );
  });

  it("a repeated sync the same month is deduped by the (rule, month) unique index, not a second push", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-budget", type: "monthly_budget", threshold: 1500 })],
      balance: 1000,
      rollupRows: recentCompleteDayRows([130, 130, 130, 130, 130, 130, 130])
    });
    mocks.adminSupabaseRequest.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "alert_events_one_per_rule_per_dedup_key_idx" (23505)')
    );
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("under budget: no event", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-budget", type: "monthly_budget", threshold: 5000 })],
      balance: 1000,
      rollupRows: recentCompleteDayRows([10, 10, 10, 10, 10, 10, 10])
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });
});

describe("evaluateAlertsAfterSync -- tariff_changed (observational, server-owned baseline)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-tariff-1" }]);
  });

  it("first enable: establishes the baseline silently -- no event, no push", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-tariff", type: "tariff_changed", threshold: null })],
      latestTariff: 2.21,
      ruleState: undefined
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      expect.stringContaining("/alert_rule_state"),
      expect.objectContaining({ alert_rule_id: "rule-tariff", state: { lastObservedTariff: 2.21 } }),
      expect.any(String)
    );
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("a material change creates an event with the exact copy example from the spec", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-tariff", type: "tariff_changed", threshold: null })],
      latestTariff: 3.11,
      ruleState: { lastObservedTariff: 2.21 }
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({
        alert_rule_id: "rule-tariff",
        event_context: { previousTariff: 2.21, currentTariff: 3.11 }
      }),
      "return=representation"
    );
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        title: "Electricity tariff changed",
        body: `Your electricity rate changed from ${formatTariff(2.21)} to ${formatTariff(3.11)}.`
      })
    );
  });

  it("numeric rounding noise below the epsilon does not count as a change", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-tariff", type: "tariff_changed", threshold: null })],
      latestTariff: 2.2101,
      ruleState: { lastObservedTariff: 2.21 }
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("re-enable semantics: disabling the rule clears its stale baseline, so re-enabling after an off-cycle tariff change establishes a fresh baseline silently instead of notifying about the historical change", async () => {
    // Step 1: the rule is disabled while its baseline was still A (2.21).
    // upsertAlertRule's own disable path must clear the evaluator state --
    // this is asserted directly against the mocked disable call, not
    // inferred, so this test fails loudly if that wiring ever regresses.
    mocks.getConnectionRowForUser.mockResolvedValue(baseConnectionRow);
    mocks.adminSupabaseRequest.mockResolvedValue([ruleRow({ id: "rule-tariff", type: "tariff_changed", enabled: false })]);
    await upsertAlertRule({ userId: "user-1", type: "tariff_changed", enabled: false, threshold: null });
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "DELETE",
      "/alert_rule_state?alert_rule_id=eq.rule-tariff",
      undefined,
      "return=minimal"
    );

    // Step 2: the tariff changes to B (3.11) while the rule sits disabled.
    // evaluateAlertsAfterSync is never even called during this window in
    // real life (the rule isn't in the enabled-rules fetch) -- nothing to
    // simulate here beyond "state stays cleared."

    // Step 3: the rule is re-enabled and the next sync runs. Because state
    // was cleared in step 1, this must behave exactly like a genuine first
    // enable -- establish B as the new baseline silently, with NO event
    // and NO push for the change that happened while the rule was off.
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-tariff-1" }]);
    routeFetchV2({
      rules: [ruleRow({ id: "rule-tariff", type: "tariff_changed", threshold: null })],
      latestTariff: 3.11,
      ruleState: undefined // cleared by the disable in step 1
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      expect.stringContaining("/alert_rule_state"),
      expect.objectContaining({ alert_rule_id: "rule-tariff", state: { lastObservedTariff: 3.11 } }),
      expect.any(String)
    );
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();

    // Step 4: only a change observed AFTER re-enable should ever notify.
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-tariff-2" }]);
    routeFetchV2({
      rules: [ruleRow({ id: "rule-tariff", type: "tariff_changed", threshold: null })],
      latestTariff: 3.68,
      ruleState: { lastObservedTariff: 3.11 } // the baseline step 3 just wrote
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({ event_context: { previousTariff: 3.11, currentTariff: 3.68 } }),
      "return=representation"
    );
    expect(mocks.sendPushToUser).toHaveBeenCalledOnce();
  });
});

describe("disableFreshDataAlertRules -- clears evaluator state for every rule it disables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears alert_rule_state for each disabled rule, including tariff_changed", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([
      ruleRow({ id: "rule-low-balance", type: "low_balance" }),
      ruleRow({ id: "rule-tariff", type: "tariff_changed", threshold: null })
    ]);

    const disabledTypes = await disableFreshDataAlertRules("conn-1");

    expect(disabledTypes).toEqual(["low_balance", "tariff_changed"]);
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "DELETE",
      "/alert_rule_state?alert_rule_id=eq.rule-low-balance",
      undefined,
      "return=minimal"
    );
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "DELETE",
      "/alert_rule_state?alert_rule_id=eq.rule-tariff",
      undefined,
      "return=minimal"
    );
  });

  it("clears nothing when nothing was actually disabled", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([]);
    const disabledTypes = await disableFreshDataAlertRules("conn-1");
    expect(disabledTypes).toEqual([]);
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledOnce(); // only the PATCH itself
  });
});

describe("evaluateAlertsAfterSync -- month-to-date window spans the full month, not just ~8 trailing days", () => {
  // 2026-08-20: day 20 of the month -- well past the 8-day window an
  // earlier version of the shared `since` calculation silently truncated
  // month-to-date sums to (the ternary picked the LATER of monthStart/
  // today-8, not the earlier -- see the `since` computation's own comment
  // in evaluateBalanceAndSpendFamily/getAlertInsights). Fixed system time
  // makes this deterministic regardless of the real run date.
  const FIXED_TODAY = "2026-08-20";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-1" }]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${FIXED_TODAY}T20:00:00Z`));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fullMonthRows(days: number, dailySpend: number, dailyKwh: number) {
    return Array.from({ length: days }, (_, index) => ({
      period_date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      total_spend: dailySpend,
      energy_kwh: dailyKwh,
      is_complete: true
    }));
  }

  it("monthly_budget's monthToDateSpend sums every complete day back to the 1st, not just the trailing 8", async () => {
    // 19 complete days (Aug 1-19) at R40/day -- a since-window truncated to
    // the trailing 8 days would only see Aug 12-19 (R320), not R760.
    routeFetchV2({
      rules: [ruleRow({ id: "rule-budget", type: "monthly_budget", threshold: 500 })],
      balance: 1000,
      rollupRows: fullMonthRows(19, 40, 5)
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({
        event_context: expect.objectContaining({ monthToDateSpend: 760 })
      }),
      "return=representation"
    );
  });

  it("tariff_band_approaching's monthKwh sums every complete day back to the 1st (its own evaluator query is independently month-scoped, never shared with the since-window above -- this guards that independence, not the bug itself)", async () => {
    // 19 days * 15 kWh = 285 kWh, genuinely within the 25 kWh warning
    // distance of the 300 kWh band edge.
    routeFetchV2({
      rules: [ruleRow({ id: "rule-band", type: "tariff_band_approaching", threshold: null })],
      tariffProfile: "newinbosch_2026_27",
      rollupRows: fullMonthRows(19, 0, 15)
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({
        event_context: { profile: "newinbosch_2026_27", monthKwh: 285, nextBandKwh: 300 }
      }),
      "return=representation"
    );
  });
});

describe("getAlertInsights", () => {
  // 2026-08-20, same as the describe block above -- this is the exact
  // function (the live Settings-tab display helper, not the evaluator)
  // whose monthKwh/monthToDateSpend a manual visual QA pass caught reading
  // only the trailing ~8 days instead of the full month, with zero prior
  // test coverage of its own. Covered directly here rather than only
  // indirectly through the evaluator tests above, since this function has
  // its own separate call site and its own separate bug surface.
  const FIXED_TODAY = "2026-08-20";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionRowForUser.mockResolvedValue({
      id: "conn-1",
      tariff_profile: "newinbosch_2026_27"
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${FIXED_TODAY}T20:00:00Z`));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function fullMonthRows(days: number, dailySpend: number, dailyKwh: number) {
    return Array.from({ length: days }, (_, index) => ({
      period_date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      total_spend: dailySpend,
      energy_kwh: dailyKwh,
      is_complete: true
    }));
  }

  it("sums monthKwh and monthToDateSpend back to the 1st of the month, not just the trailing 8 days", async () => {
    routeFetchV2({
      rules: [],
      balance: 1000,
      rollupRows: fullMonthRows(19, 40, 15),
      tariffProfile: "newinbosch_2026_27"
    });

    const insights = await getAlertInsights("user-1");

    expect(insights?.band.monthKwh).toBe(285);
    // budget.projectedSpend is only populated once dayOfMonth >= 3 and
    // there are >=5 complete recent days -- both true here -- and folds in
    // monthToDateSpend, so asserting it indirectly confirms the same
    // correct 760 monthToDateSpend the evaluator test above checks
    // directly: 760 (MTD) + 40 (avg daily rate) * 11 (remaining days) = 1200.
    expect(insights?.budget.projectedSpend).toBe(1200);
  });

  it("returns null when the user has no connection", async () => {
    mocks.getConnectionRowForUser.mockResolvedValue(null);
    await expect(getAlertInsights("user-1")).resolves.toBeNull();
  });
});

describe("evaluateAlertsAfterSync -- tariff_band_approaching (profile-gated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-band-1" }]);
  });

  it("no known tariff profile: never notifies, regardless of usage", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-band", type: "tariff_band_approaching", threshold: null })],
      tariffProfile: null,
      rollupRows: [{ period_date: TODAY, total_spend: 0, energy_kwh: 282, is_complete: true }]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("matches the spec's own worked example: 282 kWh into Newinbosch 2026/27 approaching the 300 kWh band", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-band", type: "tariff_band_approaching", threshold: null })],
      tariffProfile: "newinbosch_2026_27",
      rollupRows: [{ period_date: TODAY, total_spend: 0, energy_kwh: 282, is_complete: true }]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({
        alert_rule_id: "rule-band",
        dedup_key: `newinbosch_2026_27:${TODAY.slice(0, 7)}:300`,
        event_context: { profile: "newinbosch_2026_27", monthKwh: 282, nextBandKwh: 300 }
      }),
      "return=representation"
    );
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        title: "Approaching a higher tariff band",
        body: "You've used 282 kWh this month. Your next tariff band starts at 300 kWh."
      })
    );
  });

  it("already in the top band: never notifies (nothing to approach)", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-band", type: "tariff_band_approaching", threshold: null })],
      tariffProfile: "newinbosch_2026_27",
      rollupRows: [{ period_date: TODAY, total_spend: 0, energy_kwh: 650, is_complete: true }]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });
});

describe("evaluateAlertsAfterSync -- usage_anomaly (deterministic baseline, no ML)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-anomaly-1" }]);
  });

  // days historical samples, all the SAME weekday/weekend class as
  // `referenceDate` -- walks backward day by day and skips any date whose
  // class doesn't match, so these tests are deterministic regardless of
  // what real calendar day the suite happens to run on (a plain "last N
  // days" helper would silently mix weekday and weekend samples, and
  // whether that accidentally still clears ANOMALY_MIN_HOURLY_SAMPLES for
  // the reference date's own class depends on which day of the week the
  // suite runs -- see the dedicated weekday/weekend describe block below
  // for why that distinction matters).
  function sameClassHistoricalHours(referenceDate: string, days: number, hour: number, kwh: number) {
    const wantWeekend = isWeekendTestDate(referenceDate);
    const rows: Array<{ period_date: string; hour: number; kwh: number; intervals: number }> = [];
    for (let offset = 1; rows.length < days; offset += 1) {
      const date = shiftDate(referenceDate, -offset);
      if (isWeekendTestDate(date) === wantWeekend) {
        rows.push({ period_date: date, hour, kwh, intervals: 2 });
      }
    }
    return rows;
  }

  it("insufficient learning history (fewer than 14 distinct days): never alerts", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-anomaly", type: "usage_anomaly", threshold: null })],
      hourlyRows: [
        ...sameClassHistoricalHours(TODAY, 10, 18, 0.3),
        { period_date: TODAY, hour: 18, kwh: 3, intervals: 2 }
      ]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("detects an anomalous hour clearing both the relative and absolute floors, and merges adjacent hours into one window", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-anomaly", type: "usage_anomaly", threshold: null })],
      hourlyRows: [
        ...sameClassHistoricalHours(TODAY, 14, 18, 0.3),
        ...sameClassHistoricalHours(TODAY, 14, 19, 0.3),
        { period_date: TODAY, hour: 18, kwh: 3, intervals: 2 },
        { period_date: TODAY, hour: 19, kwh: 3, intervals: 2 }
      ],
      activities: []
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({
        alert_rule_id: "rule-anomaly",
        period_date: TODAY,
        event_context: expect.objectContaining({
          startAt: `${TODAY}T18:00:00`,
          endAt: `${TODAY}T20:00:00`
        })
      }),
      "return=representation"
    );
    expect(mocks.sendPushToUser).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        title: "What happened around 7 PM?",
        url: `/activities?new=1&date=${TODAY}&start=18:00&end=20:00&source=usage-alert`
      })
    );
  });

  it("a small ordinary swing (below the relative floor) never fires", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-anomaly", type: "usage_anomaly", threshold: null })],
      hourlyRows: [
        ...sameClassHistoricalHours(TODAY, 14, 18, 1),
        { period_date: TODAY, hour: 18, kwh: 1.2, intervals: 2 } // +20%, below the 80% relative floor
      ]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("an activity already covering most of the anomalous window suppresses the prompt", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-anomaly", type: "usage_anomaly", threshold: null })],
      hourlyRows: [
        ...sameClassHistoricalHours(TODAY, 14, 18, 0.3),
        { period_date: TODAY, hour: 18, kwh: 3, intervals: 2 }
      ],
      activities: [{ starts_at: `${TODAY}T17:45:00`, ends_at: `${TODAY}T19:15:00` }]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("a barely-touching activity does not suppress the prompt", async () => {
    routeFetchV2({
      rules: [ruleRow({ id: "rule-anomaly", type: "usage_anomaly", threshold: null })],
      hourlyRows: [
        ...sameClassHistoricalHours(TODAY, 14, 18, 0.3),
        { period_date: TODAY, hour: 18, kwh: 3, intervals: 2 }
      ],
      // Only 5 of the window's 60 minutes overlap -- far below the 50%
      // overlap threshold, so this unrelated activity must not suppress it.
      activities: [{ starts_at: `${TODAY}T18:55:00`, ends_at: `${TODAY}T21:00:00` }]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");
    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith("POST", "/alert_events", expect.anything(), "return=representation");
  });
});

describe("evaluateAlertsAfterSync -- usage_anomaly weekday/weekend readiness semantics", () => {
  // 2026-08-22 is a real Saturday (verified against the calendar) -- fixing
  // system time here is the only way to deterministically test a weekend
  // *candidate* day, since evaluateAlertsAfterSync always evaluates
  // "today" from a real `new Date()` internally.
  const WEEKEND_CANDIDATE = "2026-08-22";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendPushToUser.mockResolvedValue(1);
    mocks.adminSupabaseRequest.mockResolvedValue([{ id: "event-anomaly-weekend-1" }]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${WEEKEND_CANDIDATE}T20:30:00Z`));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function sameClassHours(referenceDate: string, days: number, hour: number, kwh: number) {
    const wantWeekend = isWeekendTestDate(referenceDate);
    const rows: Array<{ period_date: string; hour: number; kwh: number; intervals: number }> = [];
    for (let offset = 1; rows.length < days; offset += 1) {
      const date = shiftDate(referenceDate, -offset);
      if (isWeekendTestDate(date) === wantWeekend) {
        rows.push({ period_date: date, hour, kwh, intervals: 2 });
      }
    }
    return rows;
  }

  it("a real 28-day lookback gives a weekend candidate hour a genuine same-class sample pool (8 Saturdays+Sundays), and correctly detects a weekend anomaly", async () => {
    // 8 weekend samples at hour 19 (matches the real production headroom
    // check: most connections have exactly 8 complete weekend samples per
    // hour in a 28-day window) -- comfortably above ANOMALY_MIN_HOURLY_
    // SAMPLES (5). Contaminating weekday samples at the SAME hour, with a
    // deliberately different baseline (1.5kWh vs the weekend's 0.3kWh),
    // prove the weekday pool is never mixed into the weekend comparison --
    // if it were, the weekend candidate's 3kWh reading wouldn't clear an
    // 80%-above-1.5kWh relative floor.
    routeFetchV2({
      rules: [ruleRow({ id: "rule-anomaly", type: "usage_anomaly", threshold: null })],
      hourlyRows: [
        ...sameClassHours(WEEKEND_CANDIDATE, 8, 19, 0.3),
        ...sameClassHours(shiftDate(WEEKEND_CANDIDATE, -2), 12, 19, 1.5),
        { period_date: WEEKEND_CANDIDATE, hour: 19, kwh: 3, intervals: 2 }
      ]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({ alert_rule_id: "rule-anomaly", period_date: WEEKEND_CANDIDATE }),
      "return=representation"
    );
    expect(mocks.sendPushToUser).toHaveBeenCalledOnce();
  });

  it("a weekend candidate hour with fewer than 5 same-class samples is skipped, even though the connection is otherwise 'ready' (14+ total days via weekday history)", async () => {
    // Global readiness (14 distinct days) is satisfied entirely by weekday
    // history; the weekend pool at hour 19 has only 4 samples -- below
    // ANOMALY_MIN_HOURLY_SAMPLES. This is exactly the scenario the 21->28
    // day lookback widening addresses: without enough real weekend
    // history, the per-slot floor must still hold, and readiness being
    // "true" overall must not be read as a promise that every slot,
    // including sparse weekend ones, is ready too.
    routeFetchV2({
      rules: [ruleRow({ id: "rule-anomaly", type: "usage_anomaly", threshold: null })],
      hourlyRows: [
        ...sameClassHours(shiftDate(WEEKEND_CANDIDATE, -2), 14, 9, 0.5), // weekday readiness padding, different hour
        ...sameClassHours(WEEKEND_CANDIDATE, 4, 19, 0.3), // only 4 weekend samples at hour 19
        { period_date: WEEKEND_CANDIDATE, hour: 19, kwh: 3, intervals: 2 }
      ]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("a weekday candidate is unaffected by a sparse weekend pool at the same hour", async () => {
    const weekdayToday = shiftDate(WEEKEND_CANDIDATE, -3); // the preceding Wednesday
    vi.setSystemTime(new Date(`${weekdayToday}T20:30:00Z`));

    routeFetchV2({
      rules: [ruleRow({ id: "rule-anomaly", type: "usage_anomaly", threshold: null })],
      hourlyRows: [
        ...sameClassHours(weekdayToday, 14, 19, 0.3),
        ...sameClassHours(WEEKEND_CANDIDATE, 2, 19, 0.3), // sparse weekend pool, irrelevant here
        { period_date: weekdayToday, hour: 19, kwh: 3, intervals: 2 }
      ]
    });
    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "POST",
      "/alert_events",
      expect.objectContaining({ alert_rule_id: "rule-anomaly", period_date: weekdayToday }),
      "return=representation"
    );
  });
});

describe("resolveOverlappingUsageAnomalyEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves an open event when a new activity covers most of its window", async () => {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("/alert_rules")) return [{ id: "rule-anomaly" }];
      if (path.includes("/alert_events")) {
        return [
          {
            id: "event-open-1",
            event_context: { startAt: `${TODAY}T18:00:00`, endAt: `${TODAY}T20:00:00` }
          }
        ];
      }
      throw new Error(`unexpected path: ${path}`);
    });
    mocks.adminSupabaseRequest.mockResolvedValue(undefined);

    await resolveOverlappingUsageAnomalyEvents("conn-1", `${TODAY}T17:30:00`, `${TODAY}T20:00:00`);

    expect(mocks.adminSupabaseRequest).toHaveBeenCalledWith(
      "PATCH",
      expect.stringContaining("event-open-1"),
      expect.objectContaining({ resolved_at: expect.any(String) }),
      "return=minimal"
    );
  });

  it("does not resolve when the new activity barely overlaps the event's window", async () => {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("/alert_rules")) return [{ id: "rule-anomaly" }];
      if (path.includes("/alert_events")) {
        return [
          {
            id: "event-open-1",
            event_context: { startAt: `${TODAY}T18:00:00`, endAt: `${TODAY}T20:00:00` }
          }
        ];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await resolveOverlappingUsageAnomalyEvents("conn-1", `${TODAY}T19:55:00`, `${TODAY}T21:00:00`);
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });

  it("is a no-op when the connection has no usage_anomaly rule at all", async () => {
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("/alert_rules")) return [];
      throw new Error(`unexpected path: ${path}`);
    });

    await resolveOverlappingUsageAnomalyEvents("conn-1", `${TODAY}T18:00:00`, `${TODAY}T20:00:00`);
    expect(mocks.adminSupabaseRequest).not.toHaveBeenCalled();
  });
});

describe("Alerts feature gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasFeatureAccess.mockResolvedValue(true);
    mocks.getFeatureAccessForUsers.mockImplementation(async (userIds: string[]) =>
      new Map(userIds.map((userId) => [userId, { alerts: { enabled: true, source: "rollout" as const } }]))
    );
  });

  it("evaluateAlertsAfterSync skips all evaluation and push when the user lacks Alerts access", async () => {
    mocks.hasFeatureAccess.mockResolvedValue(false);

    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.hasFeatureAccess).toHaveBeenCalledWith("user-1", "alerts");
    expect(mocks.adminSupabaseFetch).not.toHaveBeenCalled();
    expect(mocks.sendPushToUser).not.toHaveBeenCalled();
  });

  it("evaluateAlertsAfterSync proceeds as normal when the user has Alerts access", async () => {
    mocks.adminSupabaseFetch.mockResolvedValue([]);

    await evaluateAlertsAfterSync("conn-1", "user-1");

    expect(mocks.hasFeatureAccess).toHaveBeenCalledWith("user-1", "alerts");
    expect(mocks.adminSupabaseFetch).toHaveBeenCalled();
  });

  it("evaluateDataDelayedAlerts excludes connections whose owner lacks Alerts access from the batch", async () => {
    mocks.getFeatureAccessForUsers.mockResolvedValue(
      new Map([
        ["user-yes", { alerts: { enabled: true, source: "rollout" as const } }],
        ["user-no", { alerts: { enabled: false, source: "rollout" as const } }]
      ])
    );
    mocks.adminSupabaseFetch.mockImplementation(async (path: string) => {
      if (path.includes("/alert_rules")) {
        // Only "conn-yes" should ever appear in the query -- "conn-no"'s
        // owner has no Alerts access, so it must be filtered out before the
        // rule fetch, not merely skipped afterwards.
        expect(path).toContain("conn-yes");
        expect(path).not.toContain("conn-no");
        return [];
      }
      throw new Error(`unexpected path: ${path}`);
    });

    const result = await evaluateDataDelayedAlerts([
      { connectionId: "conn-yes", userId: "user-yes", lastSyncedAt: null },
      { connectionId: "conn-no", userId: "user-no", lastSyncedAt: null }
    ]);

    expect(result).toEqual({ checked: 0, notified: 0 });
  });

  it("evaluateDataDelayedAlerts is a no-op when every connection's owner lacks Alerts access", async () => {
    mocks.getFeatureAccessForUsers.mockResolvedValue(
      new Map([["user-no", { alerts: { enabled: false, source: "rollout" as const } }]])
    );

    const result = await evaluateDataDelayedAlerts([{ connectionId: "conn-no", userId: "user-no", lastSyncedAt: null }]);

    expect(result).toEqual({ checked: 0, notified: 0 });
    expect(mocks.adminSupabaseFetch).not.toHaveBeenCalled();
  });
});
