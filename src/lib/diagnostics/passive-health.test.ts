import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../supabase-rest", () => ({ adminSupabaseRequest: mocks.request }));

describe("passive health cost and safety", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
    mocks.request.mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it("samples repeated outcomes on a warm instance and preserves failures separately", async () => {
    const { recordPassiveOutcome, PASSIVE_SAMPLE_MS } = await import("./passive-health");
    const start = Date.now() - 1200;
    await Promise.all(Array.from({ length: 30 }, () => recordPassiveOutcome("ai:requests", "success", start)));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await recordPassiveOutcome("ai:requests", "failure", start);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[1][2].component).toBe("passive:ai:requests:failure");
    vi.advanceTimersByTime(PASSIVE_SAMPLE_MS);
    await recordPassiveOutcome("ai:requests", "success", Date.now());
    expect(mocks.request).toHaveBeenCalledTimes(3);
  });

  it("uses one write, fixed safe fields and a timeout, without an event log or pre-read", async () => {
    const { recordPassiveOutcome } = await import("./passive-health");
    await recordPassiveOutcome("alerts:fresh", "success", Date.now() - 234, 3);
    const [method, path, body, prefer, signal] = mocks.request.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/system_health_state?on_conflict=component");
    expect(prefer).toBe("resolution=merge-duplicates,return=minimal");
    expect(body.details).toEqual({ durationMs: 234, evaluatedCount: 3 });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("records every low-frequency maintenance completion and explicit skip", async () => {
    const { recordPassiveOutcome } = await import("./passive-health");
    await recordPassiveOutcome("cron:reset-demo", "skipped", Date.now());
    await recordPassiveOutcome("cron:reset-demo", "success", Date.now());
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[0][2].last_success_at).toBeNull();
  });

  it("swallows write failures and backs off telemetry retries", async () => {
    const { recordPassiveOutcome } = await import("./passive-health");
    mocks.request.mockRejectedValue(new Error("backend down"));
    await expect(recordPassiveOutcome("alerts:fresh", "failure", Date.now())).resolves.toBeUndefined();
    await recordPassiveOutcome("alerts:fresh", "failure", Date.now());
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
