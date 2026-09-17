import { describe, expect, it } from "vitest";
import {
  amountClassFor,
  amountDisplayFor,
  balanceClassFor,
  dataDateTimeDisplayFor,
  meterEntryDisplayFor,
  tariffBandDisplayFor,
  tariffDisplayFor,
  transactionSummaryFor,
  usageDisplayFor
} from "@/components/data/row-formatting";
import { formatCurrency } from "@/lib/format";
import type { EnergyRow } from "@/lib/types";

function row(overrides: Partial<EnergyRow>): EnergyRow {
  return {
    chargeKind: "energy",
    captureTimestamp: 0,
    captureDateTime: "2026-07-25 14:00",
    ledgerTimestamp: 0,
    chargeLabel: "Energy Charge: Block 1",
    tariffBand: null,
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

describe("amountDisplayFor", () => {
  it("shows a refund as a positive credit even though its cost is stored negative", () => {
    const display = amountDisplayFor(row({ chargeKind: "refund", cost: -273.79 }));
    expect(display).toBe(formatCurrency(273.79));
    expect(display).not.toContain("-");
  });

  it("shows a top-up as a positive credit", () => {
    expect(amountDisplayFor(row({ chargeKind: "topup", cost: 500 }))).toBe(formatCurrency(500));
  });

  it("shows charge amounts unchanged", () => {
    expect(amountDisplayFor(row({ chargeKind: "energy", cost: 0.15 }))).toBe(formatCurrency(0.15));
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

describe("transactionSummaryFor", () => {
  it("explains a metered charge using labeled usage and tariff values", () => {
    expect(transactionSummaryFor(row({ usageAmount: 1.5, tariff: 2.6 }))).toBe("1,5 kWh was charged at R2,6/kWh.");
  });

  it("explains credits without exposing the refund storage sign", () => {
    expect(transactionSummaryFor(row({ chargeKind: "refund", cost: -273.79, usageUnit: null }))).toBe(
      `${formatCurrency(273.79)} was returned to the meter balance.`
    );
  });

  it("explains a fixed charge without implying metered usage", () => {
    expect(transactionSummaryFor(row({ chargeKind: "fixed", cost: 12.5, usageUnit: null }))).toBe(
      `A fixed charge of ${formatCurrency(12.5)} was applied.`
    );
  });
});

describe("dataDateTimeDisplayFor", () => {
  it("normalizes ISO-like timestamps to the meter's day-first display format", () => {
    expect(dataDateTimeDisplayFor("2026-09-16T23:30")).toBe("16/09/2026 23:30");
    expect(dataDateTimeDisplayFor("2026-09-16 23:30:00")).toBe("16/09/2026 23:30");
  });

  it("preserves an already formatted timestamp", () => {
    expect(dataDateTimeDisplayFor("17/09/2026 00:45")).toBe("17/09/2026 00:45");
  });
});

describe("meterEntryDisplayFor", () => {
  it("hides a raw label that only repeats the normalized charge type", () => {
    expect(meterEntryDisplayFor(row({ chargeKind: "water", chargeLabel: "Water:" }))).toBeNull();
  });

  it("keeps a raw label containing additional useful detail", () => {
    expect(meterEntryDisplayFor(row({ chargeLabel: "Energy Charge: Block 1" }))).toBe("Energy Charge: Block 1");
  });
});

describe("balanceClassFor", () => {
  // Same thresholds as the dashboard's own getBalanceTone (metric-cards.ts),
  // reused rather than redefined -- this is really a test that the import
  // didn't drift, not a re-test of the threshold values themselves.
  it("uses the same success green as a top-up/credit at or above 700", () => {
    expect(balanceClassFor(700)).toBe("text-success");
    expect(balanceClassFor(1200)).toBe("text-success");
  });

  it("uses an amber warning colour between 300 and 699", () => {
    expect(balanceClassFor(300)).toContain("amber");
    expect(balanceClassFor(699)).toContain("amber");
  });

  it("uses a red danger colour below 300", () => {
    expect(balanceClassFor(299)).toContain("red");
    expect(balanceClassFor(0)).toContain("red");
    expect(balanceClassFor(-50)).toContain("red");
  });
});

describe("tariffBandDisplayFor", () => {
  it("clarifies numeric tariff ranges as blocks", () => {
    expect(tariffBandDisplayFor("0 - 6")).toBe("Block 0–6");
  });

  it("preserves descriptive tariff band names", () => {
    expect(tariffBandDisplayFor("Peak")).toBe("Peak");
  });
});
