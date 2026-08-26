import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), request: vi.fn() }));
vi.mock("../supabase-rest", () => ({
  adminSupabaseFetch: mocks.fetch,
  adminSupabaseRequest: mocks.request
}));

import { openSystemIncident, sanitizeDiagnosticMessage, sanitizeSystemEventMetadata } from "./store";

describe("diagnostics event store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deduplicates an already-open incident without writing another event", async () => {
    mocks.fetch.mockResolvedValue([
      {
        id: "event-1",
        created_at: "2026-08-26T10:00:00.000Z",
        severity: "critical",
        category: "livemopay",
        event_type: "canary_failed",
        connection_id: null,
        message: "Contract check failed.",
        metadata: {},
        incident_key: "livemopay:canary",
        resolved_at: null
      }
    ]);

    const result = await openSystemIncident({
      severity: "critical",
      category: "livemopay",
      eventType: "canary_failed",
      message: "Contract check failed again.",
      incidentKey: "livemopay:canary"
    });

    expect(result.created).toBe(false);
    expect(result.escalated).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("escalates an open warning in place without creating a duplicate incident", async () => {
    const warning = {
      id: "event-1",
      created_at: "2026-08-26T10:00:00.000Z",
      severity: "warning",
      category: "scheduler",
      event_type: "scheduler_delayed",
      connection_id: null,
      message: "Scheduler is delayed.",
      metadata: {},
      incident_key: "scheduler:auto-sync:stopped",
      resolved_at: null
    };
    mocks.fetch.mockResolvedValue([warning]);
    mocks.request.mockResolvedValue([
      { ...warning, severity: "critical", event_type: "scheduler_stopped", message: "Scheduler stopped." }
    ]);

    const result = await openSystemIncident({
      severity: "critical",
      category: "scheduler",
      eventType: "scheduler_stopped",
      message: "Scheduler stopped.",
      incidentKey: "scheduler:auto-sync:stopped"
    });

    expect(result).toMatchObject({ created: false, escalated: true });
    expect(mocks.request).toHaveBeenCalledWith(
      "PATCH",
      "/system_events?id=eq.event-1",
      expect.objectContaining({ severity: "critical" }),
      "return=representation"
    );
  });

  it("removes secrets and identity fields from event metadata", () => {
    const metadata = sanitizeSystemEventMetadata({
      attempt: 2,
      step: "ledger",
      refreshToken: "never-store-this",
      deviceId: "device-secret",
      note: "GET /mobile?accountId=private"
    });

    expect(metadata).toEqual({ attempt: 2, step: "ledger", note: "GET /mobile?accountId=<redacted>" });
    expect(JSON.stringify(metadata)).not.toContain("never-store-this");
    expect(JSON.stringify(metadata)).not.toContain("device-secret");
  });

  it("redacts credentials and query values from messages", () => {
    const message = sanitizeDiagnosticMessage(
      "Bearer abc.def.ghi failed at https://example.test/path?key=secret&accountId=private for person@example.com"
    );
    expect(message).not.toContain("secret");
    expect(message).not.toContain("private");
    expect(message).not.toContain("person@example.com");
  });
});
