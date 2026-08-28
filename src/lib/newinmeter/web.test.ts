import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LiveMopayInvalidCredentialsError,
  LiveMopayTooManyAttemptsError,
  loginWithLiveMopayCredentials,
  normalizeLedgerRow
} from "@/lib/newinmeter/web";

// Fixtures mirror the real LiveMopay ledger API response shape.
const refundRow = {
  description: "Incorrect Tariff Refund",
  unitsDescription: "",
  debit: "",
  credit: "R238.08",
  balance: "R903.89",
  unitsDescriptionIncl: "",
  debitIncl: "",
  creditIncl: "R273.79",
  balanceIncl: "R1,039.47",
  date: "2026-08-08T20:00:30.0071950Z"
};

const energyRow = {
  description: "Energy Charge:  (2026-08-08 12:30)",
  unitsDescription: "0.02 @ 2.21",
  debit: "R0.04",
  credit: "",
  balance: "R903.84",
  unitsDescriptionIncl: "0.02 kWh @ R2.5415 (VAT Incl)",
  debitIncl: "R0.05",
  creditIncl: "",
  balanceIncl: "R1,039.42",
  date: "2026-08-08T20:01:35.6820910Z"
};

const topUpRow = {
  description: "",
  credit: "R500.00",
  creditIncl: "R500.00",
  balance: "R1,403.89",
  balanceIncl: "R1,539.47",
  date: "2026-08-08T20:02:00.0000000Z"
};

describe("normalizeLedgerRow", () => {
  it("parses an Incorrect Tariff Refund as a distinct, negative-cost credit with no usage", () => {
    const row = normalizeLedgerRow(refundRow);
    expect(row).not.toBeNull();
    // Keeps the refund's own description as the label (not flattened to "Top Up").
    expect(row!.charge_label).toBe("Incorrect Tariff Refund");
    // VAT-inclusive amount, stored negative so it reduces net spend downstream.
    expect(row!.cost).toBe("-273.79");
    // No electricity/water usage is invented.
    expect(row!.kwh).toBe("0");
    expect(row!.water_kl).toBe("0");
    expect(row!.tariff).toBe("0");
    // Resulting balance is captured (VAT-inclusive).
    expect(row!.balance).toBe("1039.47");
  });

  it("parses the type generically for any '... Refund' description", () => {
    const row = normalizeLedgerRow({ ...refundRow, description: "Some Other Refund" });
    expect(row!.charge_label).toBe("Some Other Refund");
    expect(row!.cost).toBe("-273.79");
  });

  it("still parses an energy charge with its usage intact", () => {
    const row = normalizeLedgerRow(energyRow);
    expect(row).not.toBeNull();
    expect(row!.kwh).toBe("0.02");
    expect(row!.tariff).toBe("2.5415");
    expect(row!.cost).toBe("0.05");
  });

  it("still parses a genuine top-up as a positive Top Up credit", () => {
    const row = normalizeLedgerRow(topUpRow);
    expect(row).not.toBeNull();
    expect(row!.charge_label).toBe("Top Up");
    expect(row!.cost).toBe("500.00");
  });
});

describe("loginWithLiveMopayCredentials", () => {
  const originalApiKey = process.env.NEWINMETER_FIREBASE_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.NEWINMETER_FIREBASE_API_KEY = "test-api-key";
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.NEWINMETER_FIREBASE_API_KEY;
    else process.env.NEWINMETER_FIREBASE_API_KEY = originalApiKey;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetchResponse(status: number, body: unknown) {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status })
    ) as unknown as typeof fetch;
  }

  it("returns a session on success", async () => {
    mockFetchResponse(200, { idToken: "id", refreshToken: "refresh", expiresIn: "3600", localId: "uid-1" });

    const session = await loginWithLiveMopayCredentials("resident@example.com", "correct-password");

    expect(session.idToken).toBe("id");
    expect(session.refreshToken).toBe("refresh");
    expect(session.localId).toBe("uid-1");
  });

  it.each(["EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "INVALID_EMAIL", "USER_DISABLED"])(
    "throws LiveMopayInvalidCredentialsError for Identity Toolkit code %s",
    async (code) => {
      mockFetchResponse(400, { error: { code: 400, message: code } });

      await expect(loginWithLiveMopayCredentials("resident@example.com", "wrong-password")).rejects.toBeInstanceOf(
        LiveMopayInvalidCredentialsError
      );
    }
  );

  it("throws LiveMopayTooManyAttemptsError when Firebase throttles the account", async () => {
    mockFetchResponse(400, { error: { code: 400, message: "TOO_MANY_ATTEMPTS_TRY_LATER" } });

    await expect(loginWithLiveMopayCredentials("resident@example.com", "x")).rejects.toBeInstanceOf(
      LiveMopayTooManyAttemptsError
    );
  });

  it("throws a generic Error (not a typed credentials error) for an unrecognized failure", async () => {
    mockFetchResponse(500, { error: { code: 500, message: "INTERNAL_ERROR" } });

    await expect(loginWithLiveMopayCredentials("resident@example.com", "x")).rejects.not.toBeInstanceOf(
      LiveMopayInvalidCredentialsError
    );
  });

  it("never includes the password in the thrown error message", async () => {
    mockFetchResponse(400, { error: { code: 400, message: "INVALID_PASSWORD" } });

    try {
      await loginWithLiveMopayCredentials("resident@example.com", "super-secret-password");
      throw new Error("expected loginWithLiveMopayCredentials to throw");
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain("super-secret-password");
    }
  });
});
