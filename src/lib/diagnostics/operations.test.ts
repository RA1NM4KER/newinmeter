import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), health: vi.fn(), event: vi.fn(), resolve: vi.fn() }));
vi.mock("./store", () => ({
  getSystemHealthState: mocks.get,
  recordSystemHealthCheck: mocks.health,
  recordSystemEvent: mocks.event,
  resolveSystemIncident: mocks.resolve,
  openSystemIncident: vi.fn(),
  sanitizeDiagnosticMessage: vi.fn()
}));
vi.mock("./notifications", () => ({ sendOperationalPushToAdmins: vi.fn() }));
import { recordSchedulerInvocation } from "./operations";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue({ lastCheckedAt: new Date(Date.now() - 3600000).toISOString() });
  mocks.health.mockResolvedValue(undefined);
  mocks.event.mockResolvedValue(undefined);
  mocks.resolve.mockResolvedValue(undefined);
});

describe("scheduler heartbeat retries", () => {
  it("retries safe reads and health upserts, then records recovery once", async () => {
    mocks.get.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
    mocks.health.mockRejectedValueOnce(new Error("network response lost"));
    await recordSchedulerInvocation({ claimed: 0 });
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.health).toHaveBeenCalledTimes(2);
    expect(mocks.event).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });

  it("does not retry event inserts after an ambiguous response", async () => {
    mocks.event.mockRejectedValueOnce(new Error("network response lost"));
    await expect(recordSchedulerInvocation({ claimed: 0 })).rejects.toThrow("network response lost");
    expect(mocks.health).toHaveBeenCalledTimes(1);
    expect(mocks.event).toHaveBeenCalledTimes(1);
  });
});
