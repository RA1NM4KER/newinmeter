import { utils, write } from "xlsx";
import type { EnergyRow } from "./types";

type ExportRow = Record<string, string | number>;

const exportHeaders = [
  "Period",
  "Type",
  "Band",
  "Usage",
  "Usage unit",
  "Tariff",
  "Tariff unit",
  "Cost (R)",
  "Balance (R)",
  "Captured"
] as const;

function toExportRows(rows: EnergyRow[]): ExportRow[] {
  return rows.map((row) => ({
    Period: row.periodDateTime.replace("T", " "),
    Type: row.chargeKind,
    Band: row.tariffBand ?? "",
    Usage: row.usageAmount,
    "Usage unit": row.usageUnit ?? "",
    Tariff: row.tariff,
    "Tariff unit": row.usageUnit ? `R/${row.usageUnit}` : "",
    "Cost (R)": row.cost,
    "Balance (R)": row.balance,
    Captured: row.captureDateTime
  }));
}

function escapeCSV(value: string | number): string {
  const str = String(value ?? "");
  return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toCSVString(rows: EnergyRow[]): string {
  const exportRows = toExportRows(rows);
  const lines = [
    exportHeaders.join(","),
    ...exportRows.map((row) => exportHeaders.map((header) => escapeCSV(row[header] ?? "")).join(","))
  ];
  return lines.join("\n");
}

export function toXLSXBuffer(rows: EnergyRow[]): Buffer {
  const ws = utils.json_to_sheet(toExportRows(rows), { header: [...exportHeaders] });
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Ledger rows");
  return write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
