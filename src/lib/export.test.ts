import { describe, expect, it } from "vitest";
import { utils, read } from "xlsx";
import { toCSVString, toXLSXBuffer } from "@/lib/export";
import type { EnergyRow } from "@/lib/types";

function energyRow(overrides: Partial<EnergyRow>): EnergyRow {
  return {
    chargeKind: "energy",
    captureTimestamp: 0,
    captureDateTime: "2026-07-25 14:30",
    ledgerTimestamp: 0,
    chargeLabel: "Energy Charge: Block 1",
    tariffBand: "0 - 50",
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

describe("toCSVString", () => {
  it("returns just the header row for an empty list", () => {
    const csv = toCSVString([]);
    expect(csv).toBe("Period,Type,Band,Usage,Usage unit,Tariff,Tariff unit,Cost (R),Balance (R),Captured");
  });

  it("writes one data line per row", () => {
    const csv = toCSVString([energyRow({}), energyRow({ cost: 10 })]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
  });

  it("exports the persisted band and wraps commas", () => {
    const csv = toCSVString([energyRow({ tariffBand: "Block 1, Peak" })]);
    expect(csv).toContain('"Block 1, Peak"');
  });

  it("escapes embedded quotes by doubling them", () => {
    const csv = toCSVString([energyRow({ tariffBand: 'Odd "label"' })]);
    expect(csv).toContain('"Odd ""label"""');
  });

  it("wraps a field containing a newline in quotes", () => {
    const csv = toCSVString([energyRow({ tariffBand: "line one\nline two" })]);
    expect(csv).toContain('"line one\nline two"');
  });

  it("leaves plain fields unquoted", () => {
    const csv = toCSVString([energyRow({})]);
    const dataLine = csv.split("\n")[1];
    expect(dataLine.startsWith('"')).toBe(false);
  });

  it("uses an empty string for a null usage unit rather than the word 'null'", () => {
    const csv = toCSVString([energyRow({ usageUnit: null, chargeKind: "fixed", chargeLabel: "Basic Service Fee" })]);
    const dataLine = csv.split("\n")[1];
    expect(dataLine).not.toContain("null");
  });
});

describe("toXLSXBuffer", () => {
  it("still writes the header row when there are no data rows", () => {
    const buffer = toXLSXBuffer([]);
    const workbook = read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = utils.sheet_to_json(sheet, { header: 1 });
    expect(data).toEqual([
      ["Period", "Type", "Band", "Usage", "Usage unit", "Tariff", "Tariff unit", "Cost (R)", "Balance (R)", "Captured"]
    ]);
  });

  it("writes header plus one row per energy row", () => {
    const buffer = toXLSXBuffer([energyRow({})]);
    const workbook = read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = utils.sheet_to_json<Record<string, unknown>>(sheet);
    expect(data).toHaveLength(1);
    expect(data[0].Period).toBe("2026-07-25 14:00");
    expect(data[0].Band).toBe("0 - 50");
  });
});
