import { describe, expect, it } from "vitest";
import { toEnergyRow, type EnergyRecordInput } from "@/lib/csv";

function record(overrides: Partial<EnergyRecordInput>): EnergyRecordInput {
  return {
    capture_dt: "25/07/2026 14:30",
    charge_label: "Energy Charge: Block 1",
    period_dt: "2026-07-25 14:00",
    kwh: "1.5",
    tariff: "2.6",
    cost: "3.9",
    balance: "69.99",
    ...overrides
  };
}

describe("toEnergyRow", () => {
  it("classifies an energy charge row", () => {
    const row = toEnergyRow(record({}));
    expect(row.chargeKind).toBe("energy");
    expect(row.usageUnit).toBe("kWh");
    expect(row.usageAmount).toBe(1.5);
  });

  it("exposes the persisted tariff band", () => {
    expect(toEnergyRow(record({ tariff_band: "300 - 600" })).tariffBand).toBe("300 - 600");
    expect(toEnergyRow(record({})).tariffBand).toBeNull();
  });

  it("classifies a water charge row", () => {
    const row = toEnergyRow(record({ charge_label: "Water: Block 1", water_kl: "0.25" }));
    expect(row.chargeKind).toBe("water");
    expect(row.usageUnit).toBe("kL");
    expect(row.usageAmount).toBe(0.25);
  });

  it("classifies a top-up row", () => {
    const row = toEnergyRow(record({ charge_label: "Top Up" }));
    expect(row.chargeKind).toBe("topup");
    expect(row.usageUnit).toBeNull();
    expect(row.usageAmount).toBe(0);
  });

  it("classifies anything else as a fixed charge", () => {
    const row = toEnergyRow(record({ charge_label: "Basic Service Fee" }));
    expect(row.chargeKind).toBe("fixed");
    expect(row.usageUnit).toBeNull();
    expect(row.usageAmount).toBe(0);
  });

  it("classifies a refund row without any usage and keeps its negative cost", () => {
    const row = toEnergyRow(record({ charge_label: "Incorrect Tariff Refund", kwh: "0", cost: "-273.79" }));
    expect(row.chargeKind).toBe("refund");
    expect(row.usageUnit).toBeNull();
    expect(row.usageAmount).toBe(0);
    expect(row.cost).toBe(-273.79);
  });

  it("parses period date/time into separate fields", () => {
    const row = toEnergyRow(record({ period_dt: "2026-07-25 14:30" }));
    expect(row.periodDate).toBe("2026-07-25");
    expect(row.periodTime).toBe("14:30");
    expect(row.periodDateTime).toBe("2026-07-25T14:30");
    expect(row.hour).toBe(14);
  });

  it("uses capture time for the ledger timestamp on non-topup rows", () => {
    const row = toEnergyRow(record({ charge_label: "Energy Charge: Block 1" }));
    expect(row.ledgerTimestamp).toBe(row.captureTimestamp);
  });

  it("uses period time for the ledger timestamp on topup rows (so top-ups sort by when they applied, not when captured)", () => {
    const row = toEnergyRow(record({ charge_label: "Top Up" }));
    expect(row.ledgerTimestamp).toBe(row.periodTimestamp);
    expect(row.ledgerTimestamp).not.toBe(row.captureTimestamp);
  });

  it("uses period time for the ledger timestamp on refund rows too", () => {
    const row = toEnergyRow(record({ charge_label: "Incorrect Tariff Refund" }));
    expect(row.ledgerTimestamp).toBe(row.periodTimestamp);
  });

  it("coerces numeric-looking strings to numbers", () => {
    const row = toEnergyRow(record({ kwh: "1.5", tariff: "2.6", cost: "3.9", balance: "69.99" }));
    expect(row.kwh).toBe(1.5);
    expect(row.tariff).toBe(2.6);
    expect(row.cost).toBe(3.9);
    expect(row.balance).toBe(69.99);
  });

  it("falls back to 0 for unparseable numeric fields instead of NaN", () => {
    const row = toEnergyRow(record({ kwh: "not-a-number" }));
    expect(row.kwh).toBe(0);
    expect(Number.isNaN(row.kwh)).toBe(false);
  });

  it("accepts numbers directly as well as strings", () => {
    const row = toEnergyRow(record({ kwh: 1.5, tariff: 2.6, cost: 3.9, balance: 69.99 }));
    expect(row.kwh).toBe(1.5);
  });

  it("defaults water_kl to 0 when omitted", () => {
    const row = toEnergyRow(record({}));
    expect(row.waterKl).toBe(0);
  });
});
