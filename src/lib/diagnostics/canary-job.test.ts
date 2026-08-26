import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordHealth: vi.fn(),
  recordEvent: vi.fn(),
  resolveIncident: vi.fn(),
  openIncident: vi.fn(),
  push: vi.fn(),
  watchdog: vi.fn()
}));
vi.mock("./store", () => ({
  recordSystemHealthCheck: mocks.recordHealth,
  recordSystemEvent: mocks.recordEvent,
  resolveSystemIncident: mocks.resolveIncident,
  openSystemIncident: mocks.openIncident
}));
vi.mock("./notifications", () => ({ sendOperationalPushToAdmins: mocks.push }));
vi.mock("./operations", () => ({ evaluateSchedulerWatchdog: mocks.watchdog }));

import { CanaryContractError } from "./canary";
import { executeDailyCanary } from "./canary-job";

describe("daily canary retry state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveIncident.mockResolvedValue(false);
    mocks.openIncident.mockResolvedValue({ created: true, event: { id: "event-1" } });
  });

  it("records a transient warning but does not push when retry succeeds", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new CanaryContractError("login", "login request returned HTTP 503."))
      .mockResolvedValueOnce({ checkedAt: "now", ledgerRows: 1, parseableLedgerRows: 1 });

    const result = await executeDailyCanary({ run, retryDelayMs: 0, delay: async () => undefined });

    expect(result).toEqual({ status: "warning", attempts: 2, failedStep: "login" });
    expect(mocks.recordHealth).toHaveBeenCalledWith(expect.objectContaining({ status: "warning", succeeded: true }));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("records critical and pushes once after both attempts fail", async () => {
    const run = vi.fn().mockRejectedValue(new CanaryContractError("ledger", "ledger contract changed."));

    const result = await executeDailyCanary({ run, retryDelayMs: 0, delay: async () => undefined });

    expect(result).toEqual({ status: "critical", attempts: 2, failedStep: "ledger" });
    expect(mocks.openIncident).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });

  it("does not duplicate a critical push while the incident remains open", async () => {
    mocks.openIncident.mockResolvedValue({ created: false, event: { id: "event-1" } });
    const run = vi.fn().mockRejectedValue(new CanaryContractError("refresh", "refresh failed."));

    await executeDailyCanary({ run, retryDelayMs: 0, delay: async () => undefined });

    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("does not retry a successful canary when the scheduler watchdog fails", async () => {
    mocks.watchdog.mockRejectedValue(new Error("watchdog unavailable"));
    const run = vi.fn().mockResolvedValue({ checkedAt: "now", ledgerRows: 1, parseableLedgerRows: 1 });

    const result = await executeDailyCanary({ run, retryDelayMs: 0, delay: async () => undefined });

    expect(result).toEqual({ status: "healthy", attempts: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps a final canary failure authoritative when operational push fails", async () => {
    mocks.push.mockRejectedValue(new Error("push unavailable"));
    const run = vi.fn().mockRejectedValue(new CanaryContractError("ledger", "ledger contract changed."));

    const result = await executeDailyCanary({ run, retryDelayMs: 0, delay: async () => undefined });

    expect(result).toEqual({ status: "critical", attempts: 2, failedStep: "ledger" });
  });
});
