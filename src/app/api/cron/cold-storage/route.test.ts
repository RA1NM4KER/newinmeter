import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCronSecret: vi.fn(),
  claim: vi.fn(),
  purge: vi.fn(),
  complete: vi.fn(),
  markError: vi.fn()
}));

vi.mock("@/lib/env", () => ({ getCronSecret: mocks.getCronSecret }));
vi.mock("@/lib/newinmeter/connection", () => ({
  claimColdStorageCandidates: mocks.claim,
  purgeColdStorageBatch: mocks.purge,
  completeConnectionHibernation: mocks.complete,
  markConnectionHibernationError: mocks.markError
}));

import { GET } from "./route";

const request = (secret = "secret") =>
  new Request("http://localhost/api/cron/cold-storage", { headers: { authorization: `Bearer ${secret}` } });

describe("cold-storage scheduled worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCronSecret.mockReturnValue("secret");
    mocks.claim.mockResolvedValue([]);
    mocks.markError.mockResolvedValue(undefined);
  });

  it("rejects requests before claiming", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
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
    await expect(response.json()).resolves.toMatchObject({
      results: [{ state: "hibernating", error: "statement timeout" }]
    });
  });
});
