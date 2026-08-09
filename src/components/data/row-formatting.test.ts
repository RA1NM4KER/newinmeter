import { describe, expect, it } from "vitest";
import { amountClassFor, tariffDisplayFor, usageDisplayFor } from "@/components/data/row-formatting";
import type { EnergyRow } from "@/lib/types";

function row(overrides: Partial<EnergyRow>): EnergyRow {
  return {
    chargeKind: "energy",
    captureTimestamp: 0,
    captureDateTime: "2026-07-25 14:00",
    ledgerTimestamp: 0,
    chargeLabel: "Energy Charge: Block 1",
    periodTimestamp: 0,
    periodDateTime: "2026-07-25T14:00",
    periodDate: "2026-07-25",
    periodTime: "14:00",
    hour: 14,
    kwh: 1.5,
    waterKl: 0,
    usageAmount: 1.5,
    usageUnit: "kWh",
    tariff: 2.6,
    cost: 3.9,
    balance: 69.99,
    ...overrides
  };
}

describe("amountClassFor", () => {
  it("uses a success color for top-ups", () => {
    expect(amountClassFor(row({ chargeKind: "topup" }))).toContain("text-success");
  });

  it("uses a success color for refunds", () => {
    expect(amountClassFor(row({ chargeKind: "refund" }))).toContain("text-success");
  });

  it("uses a fixed-charge color for fixed rows", () => {
    expect(amountClassFor(row({ chargeKind: "fixed" }))).toContain("text-fixed");
  });

  it("uses the default ink color for energy and water rows", () => {
    expect(amountClassFor(row({ chargeKind: "energy" }))).toBe("text-ink");
    expect(amountClassFor(row({ chargeKind: "water" }))).toBe("text-ink");
  });
});

describe("usageDisplayFor", () => {
  it("delegates to formatUsage with the row's amount and unit", () => {
    expect(usageDisplayFor(row({ usageAmount: 2, usageUnit: "kWh" }))).toBe("2 kWh");
  });

  it("shows a placeholder for a null unit (fixed/topup rows)", () => {
    expect(usageDisplayFor(row({ usageAmount: 0, usageUnit: null }))).toBe("-");
  });
});

describe("tariffDisplayFor", () => {
  it("delegates to formatTariffForUnit with the row's tariff and unit", () => {
    expect(tariffDisplayFor(row({ tariff: 2.6, usageUnit: "kWh" }))).toBe("R2,6/kWh");
  });

  it("shows a placeholder for a null unit", () => {
    expect(tariffDisplayFor(row({ tariff: 0, usageUnit: null }))).toBe("-");
  });
});
