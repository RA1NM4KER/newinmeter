import { describe, expect, it } from "vitest";
import { normalizeLedgerRow } from "@/lib/newinmeter/web";

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
