import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminSupabaseFetch: vi.fn(),
  adminSupabaseRequest: vi.fn(),
  adminSupabaseCount: vi.fn(),
  sendPushToUser: vi.fn(),
  getConnectionRowForUser: vi.fn(),
  setAutoSyncEnabled: vi.fn()
}));

vi.mock("../supabase-rest", () => ({
  adminSupabaseFetch: mocks.adminSupabaseFetch,
  adminSupabaseRequest: mocks.adminSupabaseRequest,
  adminSupabaseCount: mocks.adminSupabaseCount
}));
vi.mock("../push-notify", () => ({ sendPushToUser: mocks.sendPushToUser }));
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
  evaluateAlertsAfterSync,
  evaluateDataDelayedAlerts,
  getRecentNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  upsertAlertRule,
  validateThreshold
} from "./alerts";
import { DemoAccountProtectedError } from "./connection";
import { formatCurrency } from "../format";

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

  it("disables a rule without requiring a threshold change", async () => {
    mocks.adminSupabaseRequest.mockResolvedValue([ruleRow({ enabled: false })]);

    const result = await upsertAlertRule({ userId: "user-1", type: "low_balance", enabled: false, threshold: 200 });

    expect(result.rule.enabled).toBe(false);
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
    if (path.includes("/alert_rules") && path.includes("type=in.(low_balance,daily_spend,daily_kwh)")) {
      return responses.rules ?? [];
    }
    if (path.includes("/alert_rules") && path.includes("type=eq.data_delayed")) {
      return responses.dataDelayedRule ? [responses.dataDelayedRule] : [];
    }
    if (path.includes("/dashboard_summary")) {
      return responses.balance === undefined ? [] : [{ latest_balance: responses.balance }];
    }
    if (path.includes("/energy_day_rollups")) {
      return responses.todayRollup ? [responses.todayRollup] : [];
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
