import { utils, write } from "xlsx";
import type { ActivityReportRow } from "../types";

const headers = [
  "Date",
  "Start time",
  "End time",
  "Whole day",
  "Tags",
  "Note",
  "Duration in minutes",
  "Electricity usage in kWh",
  "Average demand in kW",
  "Electricity spend",
  "Water usage in kL",
  "Water spend"
] as const;

function escapeCsv(value: string | number | boolean) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Matches the UI's own rounding (lib/format.ts uses maximumFractionDigits: 2)
// so an export doesn't show more precision than the app ever displays --
// raw floats like 0.37916666666666665 otherwise leak straight from the
// interval-sum arithmetic into the file a user opens in a spreadsheet.
function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function activityExportValues(rows: ActivityReportRow[]) {
  return rows.map((row) => [
    row.date,
    row.startsAt.slice(11, 16),
    row.endsAt.slice(11, 16),
    row.allDay,
    row.tags.join("; "),
    row.note ?? "",
    row.durationMinutes,
    round2(row.electricityKwh),
    round2(row.averageKw),
    round2(row.electricitySpend),
    round2(row.waterKl),
    round2(row.waterSpend)
  ]);
}

export function activityReportToCsv(rows: ActivityReportRow[]) {
  const values = activityExportValues(rows);
  return [headers.join(","), ...values.map((row) => row.map(escapeCsv).join(","))].join("\n");
}

export function activityReportToXlsx(rows: ActivityReportRow[]) {
  const worksheet = utils.aoa_to_sheet([[...headers], ...activityExportValues(rows)]);
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, "Activities");
  return write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
