import { describe, expect, it, vi } from "vitest";
import { CanaryContractError, runLiveMopayContractCanary } from "./canary";

const now = new Date("2026-08-26T10:00:00.000Z");

function dependencies() {
  return {
    getConfig: () => ({ email: "canary@example.test", password: "private-password", accountId: "canary-account" }),
    login: vi.fn().mockResolvedValue({
      idToken: "login-id-token",
      refreshToken: "login-refresh-token",
      expiresAt: "2026-08-26T11:00:00.000Z"
    }),
    refresh: vi.fn().mockResolvedValue({
      idToken: "fresh-id-token",
      refreshToken: "fresh-refresh-token",
      expiresAt: "2026-08-26T11:00:00.000Z"
    }),
    discover: vi
      .fn()
      .mockResolvedValue([
        { accountId: "canary-account", companyId: "company", propertyId: "property", label: "Canary" }
      ]),
    checkLedger: vi.fn().mockResolvedValue({ rowCount: 2, parseableRowCount: 2 }),
    now: () => now
  };
}

describe("LiveMopay contract canary", () => {
  it("validates login, refresh, discovery identity, and a small ledger parse", async () => {
    const deps = dependencies();
    const result = await runLiveMopayContractCanary(deps);

    expect(deps.refresh).toHaveBeenCalledWith("login-refresh-token");
    expect(deps.discover).toHaveBeenCalledWith("fresh-id-token");
    expect(deps.checkLedger).toHaveBeenCalledWith(expect.objectContaining({ startDate: "2026-08-19" }));
    expect(result).toEqual({ checkedAt: now.toISOString(), ledgerRows: 2, parseableLedgerRows: 2 });
    expect(JSON.stringify(result)).not.toContain("token");
    expect(JSON.stringify(result)).not.toContain("private-password");
  });

  it("fails at login when required token/expiry fields disappear", async () => {
    const deps = dependencies();
    deps.login.mockResolvedValue({ idToken: "", refreshToken: "", expiresAt: "" });

    await expect(runLiveMopayContractCanary(deps)).rejects.toMatchObject({ step: "login" });
    expect(deps.refresh).not.toHaveBeenCalled();
  });

  it("fails discovery when the configured account loses required identity fields", async () => {
    const deps = dependencies();
    deps.discover.mockResolvedValue([]);

    await expect(runLiveMopayContractCanary(deps)).rejects.toMatchObject({ step: "discovery" });
    expect(deps.checkLedger).not.toHaveBeenCalled();
  });

  it("returns only a sanitized step/message for upstream failures", async () => {
    const deps = dependencies();
    deps.refresh.mockRejectedValue(
      new Error("POST https://securetoken.googleapis.com/v1/token?key=super-secret failed with 401: token=private")
    );

    let error: CanaryContractError | null = null;
    try {
      await runLiveMopayContractCanary(deps);
    } catch (caught) {
      error = caught as CanaryContractError;
    }
    expect(error).not.toBeNull();
    if (!error) throw new Error("Expected the canary to fail.");
    expect(error.step).toBe("refresh");
    expect(error.message).toBe("refresh request returned HTTP 401.");
    expect(error.message).not.toContain("super-secret");
    expect(error.message).not.toContain("private");
  });
});
