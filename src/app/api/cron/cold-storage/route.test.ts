import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordPassiveOutcome: vi.fn(),
  pruneObservations: vi.fn(),
  getCronSecret: vi.fn(),
  claim: vi.fn(),
  purge: vi.fn(),
  complete: vi.fn(),
  markError: vi.fn()
}));

vi.mock("@/lib/newinmeter/availability-storage", () => ({ pruneElectricityObservations: mocks.pruneObservations }));

vi.mock("@/lib/env", () => ({ getCronSecret: mocks.getCronSecret }));
vi.mock("@/lib/newinmeter/connection", () => ({
  claimColdStorageCandidates: mocks.claim,
  purgeColdStorageBatch: mocks.purge,
  completeConnectionHibernation: mocks.complete,
  markConnectionHibernationError: mocks.markError
}));

vi.mock("@/lib/diagnostics/passive-health", () => ({ recordPassiveOutcome: mocks.recordPassiveOutcome }));

import { GET } from "./route";

const request = (secret = "secret") =>
  new Request("http://localhost/api/cron/cold-storage", { headers: { authorization: `Bearer ${secret}` } });

describe("cold-storage scheduled worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCronSecret.mockReturnValue("secret");
    mocks.pruneObservations.mockResolvedValue(0);
    mocks.claim.mockResolvedValue([]);
    mocks.markError.mockResolvedValue(undefined);
  });

  it("rejects requests before claiming", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.pruneObservations).not.toHaveBeenCalled();
    expect(mocks.recordPassiveOutcome).not.toHaveBeenCalled();
  });

  it("continues bounded batches and marks cold only after the purge is empty", async () => {
    mocks.claim.mockResolvedValue([{ connectionId: "conn-a", userId: "user-a" }]);
    mocks.purge
      .mockResolvedValueOnce({
        energyRowsDeleted: 2000,
        hourlyRollupsDeleted: 10,
        intervalRollupsDeleted: 2000,
        remaining: true
      })
      .mockResolvedValueOnce({
        energyRowsDeleted: 50,
        hourlyRollupsDeleted: 0,
        intervalRollupsDeleted: 20,
        remaining: false
      });
    mocks.complete.mockResolvedValue(undefined);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.purge).toHaveBeenCalledTimes(2);
    expect(mocks.purge).toHaveBeenCalledWith("conn-a", 2000);
    expect(mocks.complete).toHaveBeenCalledWith("conn-a");
    expect(mocks.recordPassiveOutcome).toHaveBeenCalledWith("cron:cold-storage", "success", expect.any(Number));
    await expect(response.json()).resolves.toMatchObject({
      claimed: 1,
      results: [{ state: "cold", deleted: { energyRows: 2050, intervalRollups: 2020 } }]
    });
  });

  it("keeps a failed connection hibernating and records an operational error", async () => {
    mocks.claim.mockResolvedValue([{ connectionId: "conn-a", userId: "user-a" }]);
    mocks.purge.mockRejectedValue(new Error("statement timeout"));

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.markError).toHaveBeenCalledWith("conn-a", "statement timeout");
    expect(mocks.recordPassiveOutcome).toHaveBeenCalledWith("cron:cold-storage", "failure", expect.any(Number));
    await expect(response.json()).resolves.toMatchObject({
      results: [{ state: "hibernating", error: "statement timeout" }]
    });
  });
  it("prunes passive evidence on the existing daily invocation even without cold accounts", async () => {
    mocks.pruneObservations.mockResolvedValue(12);
    await expect((await GET(request())).json()).resolves.toMatchObject({
      claimed: 0,
      availabilityObservationsPruned: 12
    });
    expect(mocks.pruneObservations).toHaveBeenCalledOnce();
  });
  it("keeps lifecycle work successful when passive retention is unavailable", async () => {
    mocks.pruneObservations.mockResolvedValue(null);
    await expect((await GET(request())).json()).resolves.toMatchObject({
      ok: true,
      availabilityObservationsPruned: null
    });
  });
  it("records an invocation failure when claiming cannot complete", async () => {
    mocks.claim.mockRejectedValueOnce(new Error("unavailable"));
    await expect(GET(request())).rejects.toThrow("unavailable");
    expect(mocks.recordPassiveOutcome).toHaveBeenCalledWith("cron:cold-storage", "failure", expect.any(Number));
  });
});
