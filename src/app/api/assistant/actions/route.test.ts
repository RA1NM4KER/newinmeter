import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireConnectedSession: vi.fn(),
  hasFeatureAccess: vi.fn(),
  enforceRateLimit: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  resolveOverlappingUsageAnomalyEvents: vi.fn(),
  upsertAlertRule: vi.fn(),
  getAlertRulesForUser: vi.fn(),
  evaluateAlertsAfterSync: vi.fn(),
  getConnectionRowForUser: vi.fn(),
  getDecryptedRefreshToken: vi.fn(),
  markConnectionAuthError: vi.fn(),
  markConnectionSyncOutcome: vi.fn(),
  replaceConnectionRefreshToken: vi.fn(),
  runLivemopaySync: vi.fn(),
  loadDashboardSummary: vi.fn()
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T>(fn: T) => fn };
});
vi.mock("@/lib/auth/session", () => ({ requireConnectedSession: mocks.requireConnectedSession }));
vi.mock("@/lib/features", () => ({ hasFeatureAccess: mocks.hasFeatureAccess }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  getRateLimitIdentifier: (userId: string, scope: string) => `${userId}:${scope}`,
  rateLimitHeaders: () => ({})
}));
vi.mock("@/lib/activity/data", () => ({
  activityValidationErrors: (error: { validationErrors?: Record<string, string> }) => error.validationErrors,
  createActivity: mocks.createActivity,
  updateActivity: mocks.updateActivity,
  deleteActivity: mocks.deleteActivity
}));
vi.mock("@/lib/dashboard-data", () => ({ loadDashboardSummary: mocks.loadDashboardSummary }));
vi.mock("@/lib/newinmeter/alerts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/alerts")>("@/lib/newinmeter/alerts");
  return {
    ...actual,
    upsertAlertRule: mocks.upsertAlertRule,
    getAlertRulesForUser: mocks.getAlertRulesForUser,
    evaluateAlertsAfterSync: mocks.evaluateAlertsAfterSync,
    resolveOverlappingUsageAnomalyEvents: mocks.resolveOverlappingUsageAnomalyEvents
  };
});
vi.mock("@/lib/newinmeter/connection", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/connection")>("@/lib/newinmeter/connection");
  return {
    ...actual,
    getConnectionRowForUser: mocks.getConnectionRowForUser,
    getDecryptedRefreshToken: mocks.getDecryptedRefreshToken,
    markConnectionAuthError: mocks.markConnectionAuthError,
    markConnectionSyncOutcome: mocks.markConnectionSyncOutcome,
    replaceConnectionRefreshToken: mocks.replaceConnectionRefreshToken
  };
});
vi.mock("@/lib/newinmeter/sync", async () => {
  const actual = await vi.importActual<typeof import("@/lib/newinmeter/sync")>("@/lib/newinmeter/sync");
  return { ...actual, runLivemopaySync: mocks.runLivemopaySync };
});

import { AlertRuleValidationError, AutoSyncRequiredError } from "@/lib/newinmeter/alerts";
import { DemoAccountProtectedError } from "@/lib/newinmeter/connection";
import { SyncAlreadyRunningError } from "@/lib/newinmeter/sync";
import { TokenDecryptionError } from "@/lib/token-encryption";
import { POST } from "./route";

const session = { userId: "user-a", accessToken: "token", connection: { id: "conn-a", isDemo: false } };

function request(body: unknown) {
  return new Request("http://localhost/api/assistant/actions", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/assistant/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireConnectedSession.mockResolvedValue({ ok: true, session });
    mocks.hasFeatureAccess.mockResolvedValue(true);
    mocks.enforceRateLimit.mockResolvedValue({ allowed: true, minute: {}, day: {} });
    mocks.markConnectionAuthError.mockResolvedValue(undefined);
    mocks.markConnectionSyncOutcome.mockResolvedValue(undefined);
  });

  it("requires authentication", async () => {
    mocks.requireConnectedSession.mockResolvedValue({ ok: false, status: 401 });
    const response = await POST(request({ type: "sync" }));
    expect(response.status).toBe(401);
  });

  it("returns 403 when the AI feature is off, before any per-action feature check", async () => {
    mocks.hasFeatureAccess.mockResolvedValue(false);
    const response = await POST(request({ type: "sync" }));
    expect(response.status).toBe(403);
    expect(mocks.getConnectionRowForUser).not.toHaveBeenCalled();
  });

  it("returns 429 and performs no mutation when the rate limit is exceeded", async () => {
    mocks.enforceRateLimit.mockResolvedValue({ allowed: false, minute: {}, day: {} });
    const response = await POST(request({ type: "sync" }));
    expect(response.status).toBe(429);
    expect(mocks.getConnectionRowForUser).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized action type with 400", async () => {
    const response = await POST(request({ type: "delete_everything" }));
    expect(response.status).toBe(400);
  });

  it("rejects an arbitrary alert type not in ALERT_TYPES", async () => {
    const response = await POST(request({ type: "set_alert", alertType: "totally_made_up", threshold: 100 }));
    expect(response.status).toBe(400);
    expect(mocks.upsertAlertRule).not.toHaveBeenCalled();
  });

  it("rejects a non-half-hour add_activity start time", async () => {
    const response = await POST(
      request({ type: "add_activity", date: "2026-08-20", start: "18:07", end: "19:00", tags: ["geyser"] })
    );
    expect(response.status).toBe(400);
    expect(mocks.createActivity).not.toHaveBeenCalled();
  });

  it("rejects add_activity with zero tags", async () => {
    const response = await POST(
      request({ type: "add_activity", date: "2026-08-20", start: "18:00", end: "19:00", tags: [] })
    );
    expect(response.status).toBe(400);
    expect(mocks.createActivity).not.toHaveBeenCalled();
  });

  describe("add_activity", () => {
    function activityRequest(overrides: Record<string, unknown> = {}) {
      return request({
        type: "add_activity",
        date: "2026-08-20",
        start: "18:00",
        end: "19:00",
        tags: ["geyser"],
        ...overrides
      });
    }

    it("returns 403 when Activities is disabled for this account", async () => {
      mocks.hasFeatureAccess.mockImplementation(async (_userId: string, key: string) => key === "ai");
      const response = await POST(activityRequest());
      expect(response.status).toBe(403);
      expect(mocks.createActivity).not.toHaveBeenCalled();
    });

    it("blocks the demo account, without ever calling createActivity", async () => {
      mocks.requireConnectedSession.mockResolvedValue({
        ok: true,
        session: { ...session, connection: { ...session.connection, isDemo: true } }
      });
      const response = await POST(activityRequest());
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.demoAccount).toBe(true);
      expect(mocks.createActivity).not.toHaveBeenCalled();
    });

    it("creates the activity using the session's own connection id, and best-effort resolves overlapping usage_anomaly events", async () => {
      mocks.createActivity.mockResolvedValue({
        id: "activity-1",
        startsAt: "2026-08-20T18:00:00",
        endsAt: "2026-08-20T19:00:00",
        allDay: false,
        tags: ["geyser"],
        color: "#0f766e",
        createdAt: "now",
        updatedAt: "now"
      });

      const response = await POST(activityRequest());

      expect(response.status).toBe(201);
      expect(mocks.createActivity).toHaveBeenCalledWith(
        "token",
        "conn-a",
        expect.objectContaining({
          date: "2026-08-20",
          startTime: "18:00",
          endTime: "19:00",
          tags: ["geyser"],
          allDay: false
        })
      );
      expect(mocks.resolveOverlappingUsageAnomalyEvents).toHaveBeenCalledWith(
        "conn-a",
        "2026-08-20T18:00:00",
        "2026-08-20T19:00:00"
      );
    });

    it("supports an overnight activity (end time before start time)", async () => {
      mocks.createActivity.mockResolvedValue({
        id: "activity-2",
        startsAt: "2026-08-20T22:00:00",
        endsAt: "2026-08-21T05:00:00",
        allDay: false,
        tags: ["geyser"],
        color: "#0f766e",
        createdAt: "now",
        updatedAt: "now"
      });

      const response = await POST(activityRequest({ start: "22:00", end: "05:00" }));

      expect(response.status).toBe(201);
      expect(mocks.createActivity).toHaveBeenCalledWith(
        "token",
        "conn-a",
        expect.objectContaining({ startTime: "22:00", endTime: "05:00" })
      );
    });

    it("returns 400 with field errors when the domain layer rejects the input", async () => {
      mocks.createActivity.mockRejectedValue({ validationErrors: { tags: "Add at least one tag." } });
      const response = await POST(activityRequest());
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.errors).toEqual({ tags: "Add at least one tag." });
    });
  });

  describe("update_activity", () => {
    function updateRequest(overrides: Record<string, unknown> = {}) {
      return request({
        type: "update_activity",
        activityId: "activity-1",
        date: "2026-08-20",
        start: "18:00",
        end: "19:00",
        tags: ["geyser"],
        note: null,
        ...overrides
      });
    }

    it("returns 403 when Activities is disabled for this account", async () => {
      mocks.hasFeatureAccess.mockImplementation(async (_userId: string, key: string) => key === "ai");
      const response = await POST(updateRequest());
      expect(response.status).toBe(403);
      expect(mocks.updateActivity).not.toHaveBeenCalled();
    });

    it("blocks the demo account, without ever calling updateActivity", async () => {
      mocks.requireConnectedSession.mockResolvedValue({
        ok: true,
        session: { ...session, connection: { ...session.connection, isDemo: true } }
      });
      const response = await POST(updateRequest());
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.demoAccount).toBe(true);
      expect(mocks.updateActivity).not.toHaveBeenCalled();
    });

    it("resolves ownership via RLS (session accessToken/connection id), never a client-supplied id", async () => {
      mocks.updateActivity.mockResolvedValue({
        id: "activity-1",
        startsAt: "2026-08-20T18:00:00",
        endsAt: "2026-08-20T19:00:00",
        allDay: false,
        tags: ["geyser"],
        color: "#0f766e",
        createdAt: "now",
        updatedAt: "now"
      });

      const response = await POST(updateRequest({ userId: "someone-else" }));

      expect(response.status).toBe(200);
      expect(mocks.updateActivity).toHaveBeenCalledWith(
        "token",
        "conn-a",
        "activity-1",
        expect.objectContaining({ date: "2026-08-20", startTime: "18:00", endTime: "19:00", tags: ["geyser"] })
      );
    });

    it("preserves the full tag list sent by the caller, including when removing one of several", async () => {
      mocks.updateActivity.mockResolvedValue({
        id: "activity-1",
        startsAt: "2026-08-20T18:00:00",
        endsAt: "2026-08-20T19:00:00",
        allDay: false,
        tags: ["geyser", "heater"],
        color: "#0f766e",
        createdAt: "now",
        updatedAt: "now"
      });

      await POST(updateRequest({ tags: ["geyser", "heater"] }));

      expect(mocks.updateActivity).toHaveBeenCalledWith(
        "token",
        "conn-a",
        "activity-1",
        expect.objectContaining({ tags: ["geyser", "heater"] })
      );
    });

    it("supports an overnight activity (end time before start time)", async () => {
      mocks.updateActivity.mockResolvedValue({
        id: "activity-1",
        startsAt: "2026-08-20T22:00:00",
        endsAt: "2026-08-21T05:00:00",
        allDay: false,
        tags: ["geyser"],
        color: "#0f766e",
        createdAt: "now",
        updatedAt: "now"
      });

      const response = await POST(updateRequest({ start: "22:00", end: "05:00" }));

      expect(response.status).toBe(200);
      expect(mocks.updateActivity).toHaveBeenCalledWith(
        "token",
        "conn-a",
        "activity-1",
        expect.objectContaining({ startTime: "22:00", endTime: "05:00" })
      );
    });

    it("returns 404 (never a 403/500 that would distinguish it) when the id doesn't exist or isn't owned by this user -- RLS returns null either way", async () => {
      mocks.updateActivity.mockResolvedValue(null);
      const response = await POST(updateRequest({ activityId: "someone-elses-activity" }));
      expect(response.status).toBe(404);
    });

    it("returns 400 with field errors when the domain layer rejects the input", async () => {
      mocks.updateActivity.mockRejectedValue({ validationErrors: { tags: "Add at least one tag." } });
      const response = await POST(updateRequest({ tags: [] }));
      expect(response.status).toBe(400);
    });

    it("rejects a request with zero tags at the schema level, before ever reaching updateActivity", async () => {
      const response = await POST(updateRequest({ tags: [] }));
      expect(response.status).toBe(400);
      expect(mocks.updateActivity).not.toHaveBeenCalled();
    });
  });

  describe("delete_activity", () => {
    function deleteRequest(overrides: Record<string, unknown> = {}) {
      return request({ type: "delete_activity", activityId: "activity-1", ...overrides });
    }

    it("returns 403 when Activities is disabled for this account", async () => {
      mocks.hasFeatureAccess.mockImplementation(async (_userId: string, key: string) => key === "ai");
      const response = await POST(deleteRequest());
      expect(response.status).toBe(403);
      expect(mocks.deleteActivity).not.toHaveBeenCalled();
    });

    it("blocks the demo account, without ever calling deleteActivity", async () => {
      mocks.requireConnectedSession.mockResolvedValue({
        ok: true,
        session: { ...session, connection: { ...session.connection, isDemo: true } }
      });
      const response = await POST(deleteRequest());
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.demoAccount).toBe(true);
      expect(mocks.deleteActivity).not.toHaveBeenCalled();
    });

    it("deletes using the session's own accessToken (RLS ownership), never a client-supplied user id", async () => {
      mocks.deleteActivity.mockResolvedValue({
        id: "activity-1",
        startsAt: "2026-08-20T18:00:00",
        endsAt: "2026-08-20T19:00:00",
        allDay: false,
        tags: ["geyser"],
        color: "#0f766e",
        createdAt: "now",
        updatedAt: "now"
      });

      const response = await POST(deleteRequest({ userId: "someone-else" }));

      expect(response.status).toBe(200);
      expect(mocks.deleteActivity).toHaveBeenCalledWith("token", "activity-1");
    });

    it("returns 404 when the id doesn't exist or isn't owned by this user", async () => {
      mocks.deleteActivity.mockResolvedValue(null);
      const response = await POST(deleteRequest({ activityId: "someone-elses-activity" }));
      expect(response.status).toBe(404);
    });
  });

  describe("set_alert / update_alert / disable_alert", () => {
    it("returns 403 when Alerts is disabled for this account", async () => {
      mocks.hasFeatureAccess.mockImplementation(async (_userId: string, key: string) => key === "ai");
      const response = await POST(request({ type: "set_alert", alertType: "low_balance", threshold: 300 }));
      expect(response.status).toBe(403);
      expect(mocks.upsertAlertRule).not.toHaveBeenCalled();
    });

    it("calls upsertAlertRule with the authenticated session's own userId, never a client-supplied one", async () => {
      mocks.upsertAlertRule.mockResolvedValue({
        rule: {
          id: "r1",
          connectionId: "conn-a",
          type: "low_balance",
          enabled: true,
          threshold: 300,
          updatedAt: "now"
        },
        autoSyncEnabled: true,
        nextSyncAt: null
      });

      await POST(request({ type: "set_alert", alertType: "low_balance", threshold: 300, userId: "someone-else" }));

      expect(mocks.upsertAlertRule).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-a", type: "low_balance", enabled: true, threshold: 300 })
      );
    });

    it("update_alert behaves identically to set_alert (enabled: true)", async () => {
      mocks.upsertAlertRule.mockResolvedValue({
        rule: { id: "r1", connectionId: "conn-a", type: "daily_spend", enabled: true, threshold: 60, updatedAt: "now" },
        autoSyncEnabled: true,
        nextSyncAt: null
      });

      const response = await POST(request({ type: "update_alert", alertType: "daily_spend", threshold: 60 }));

      expect(response.status).toBe(200);
      expect(mocks.upsertAlertRule).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, threshold: 60 }));
    });

    it("disable_alert re-sends the existing rule's own threshold rather than null, since validateThreshold requires one for threshold-bearing types", async () => {
      mocks.getAlertRulesForUser.mockResolvedValue([
        { id: "r1", connectionId: "conn-a", type: "daily_spend", enabled: true, threshold: 75, updatedAt: "now" }
      ]);
      mocks.upsertAlertRule.mockResolvedValue({
        rule: {
          id: "r1",
          connectionId: "conn-a",
          type: "daily_spend",
          enabled: false,
          threshold: 75,
          updatedAt: "now"
        },
        autoSyncEnabled: true,
        nextSyncAt: null
      });

      await POST(request({ type: "disable_alert", alertType: "daily_spend" }));

      expect(mocks.upsertAlertRule).toHaveBeenCalledWith(
        expect.objectContaining({ type: "daily_spend", enabled: false, threshold: 75 })
      );
    });

    it("falls back to the product default threshold when disabling a type that was never configured", async () => {
      mocks.getAlertRulesForUser.mockResolvedValue([]);
      mocks.upsertAlertRule.mockResolvedValue({
        rule: {
          id: "r1",
          connectionId: "conn-a",
          type: "low_balance",
          enabled: false,
          threshold: 200,
          updatedAt: "now"
        },
        autoSyncEnabled: true,
        nextSyncAt: null
      });

      await POST(request({ type: "disable_alert", alertType: "low_balance" }));

      expect(mocks.upsertAlertRule).toHaveBeenCalledWith(expect.objectContaining({ threshold: 200 }));
    });

    it("returns 409 with autoSyncRequired, without mutating, when the domain layer requires confirmation", async () => {
      mocks.upsertAlertRule.mockRejectedValue(new AutoSyncRequiredError());
      const response = await POST(request({ type: "set_alert", alertType: "monthly_budget", threshold: 1000 }));
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.autoSyncRequired).toBe(true);
    });

    it("passes alsoEnableAutoSync through when the client confirms the secondary prompt", async () => {
      mocks.upsertAlertRule.mockResolvedValue({
        rule: {
          id: "r1",
          connectionId: "conn-a",
          type: "monthly_budget",
          enabled: true,
          threshold: 1000,
          updatedAt: "now"
        },
        autoSyncEnabled: true,
        nextSyncAt: null
      });

      await POST(
        request({ type: "set_alert", alertType: "monthly_budget", threshold: 1000, alsoEnableAutoSync: true })
      );

      expect(mocks.upsertAlertRule).toHaveBeenCalledWith(expect.objectContaining({ alsoEnableAutoSync: true }));
    });

    it("returns 400 for an invalid threshold surfaced by domain validation", async () => {
      mocks.upsertAlertRule.mockRejectedValue(new AlertRuleValidationError("Must be greater than 0."));
      const response = await POST(request({ type: "set_alert", alertType: "daily_spend", threshold: -5 }));
      expect(response.status).toBe(400);
    });

    it("returns 403 demoAccount for a demo connection", async () => {
      mocks.upsertAlertRule.mockRejectedValue(new DemoAccountProtectedError("alerts"));
      const response = await POST(request({ type: "set_alert", alertType: "low_balance", threshold: 300 }));
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.demoAccount).toBe(true);
    });
  });

  describe("sync", () => {
    function connectedRow(overrides: Record<string, unknown> = {}) {
      return {
        id: "conn-a",
        status: "connected",
        account_id: "acc-1",
        company_id: "co-1",
        property_id: "prop-1",
        is_demo: false,
        ...overrides
      };
    }

    it("returns 409 when there's no usable LiveMopay connection", async () => {
      mocks.getConnectionRowForUser.mockResolvedValue(null);
      const response = await POST(request({ type: "sync" }));
      expect(response.status).toBe(409);
      expect(mocks.runLivemopaySync).not.toHaveBeenCalled();
    });

    it("blocks the demo account before ever decrypting a token", async () => {
      mocks.getConnectionRowForUser.mockResolvedValue(connectedRow({ is_demo: true }));
      const response = await POST(request({ type: "sync" }));
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.demoAccount).toBe(true);
      expect(mocks.getDecryptedRefreshToken).not.toHaveBeenCalled();
    });

    it("runs an incremental sync, evaluates alerts, and returns the refreshed summary", async () => {
      mocks.getConnectionRowForUser.mockResolvedValue(connectedRow());
      mocks.getDecryptedRefreshToken.mockReturnValue("refresh-token");
      mocks.runLivemopaySync.mockResolvedValue({ output: { rowsSynced: 10 } });
      mocks.loadDashboardSummary.mockResolvedValue({ dateEnd: "2026-08-20" });

      const response = await POST(request({ type: "sync" }));

      expect(response.status).toBe(200);
      expect(mocks.runLivemopaySync).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: "conn-a", mode: "incremental" })
      );
      expect(mocks.evaluateAlertsAfterSync).toHaveBeenCalledWith("conn-a", "user-a");
      const body = await response.json();
      expect(body.summary).toEqual({ dateEnd: "2026-08-20" });
    });

    it("returns 409 when a sync is already running for this connection", async () => {
      mocks.getConnectionRowForUser.mockResolvedValue(connectedRow());
      mocks.getDecryptedRefreshToken.mockReturnValue("refresh-token");
      mocks.runLivemopaySync.mockRejectedValue(new SyncAlreadyRunningError());
      const response = await POST(request({ type: "sync" }));
      expect(response.status).toBe(409);
    });

    it("returns 409 reauthRequired and marks the connection's auth error on a token decryption failure", async () => {
      mocks.getConnectionRowForUser.mockResolvedValue(connectedRow());
      mocks.getDecryptedRefreshToken.mockImplementation(() => {
        throw new TokenDecryptionError("bad key");
      });
      const response = await POST(request({ type: "sync" }));
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.reauthRequired).toBe(true);
      expect(mocks.markConnectionAuthError).toHaveBeenCalledWith("conn-a");
    });

    it("returns a generic 500 without leaking the underlying sync error message", async () => {
      mocks.getConnectionRowForUser.mockResolvedValue(connectedRow());
      mocks.getDecryptedRefreshToken.mockReturnValue("refresh-token");
      mocks.runLivemopaySync.mockRejectedValue(new Error("LiveMopay 500 at internal-host:8443"));
      const response = await POST(request({ type: "sync" }));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.message).not.toContain("internal-host");
    });
  });
});
