import { describe, expect, it } from "vitest";
import { read, utils } from "xlsx";
import { activityReportToCsv, activityReportToXlsx } from "./export";
import type { ActivityReportRow } from "../types";

const reportRow: ActivityReportRow = {
  id: "a",
  date: "2026-08-04",
  startsAt: "2026-08-04T18:00:00",
  endsAt: "2026-08-04T20:30:00",
  allDay: false,
  tags: ["geyser", "heater"],
  color: "#0f766e",
  note: "Cold, rainy",
  createdAt: "",
  updatedAt: "",
  durationMinutes: 150,
  electricityKwh: 5,
  averageKw: 2,
  electricitySpend: 12,
  waterKl: 0.3,
  waterSpend: 4
};

describe("activity report export", () => {
  it("exports every report metric and safely escapes notes", () => {
    const csv = activityReportToCsv([reportRow]);
    expect(csv).toContain("Electricity usage in kWh");
    expect(csv).toContain("geyser; heater");
    expect(csv).toContain('"Cold, rainy"');
    expect(csv).toContain("150,5,2,12,0.3,4");
  });

  it("exports the same activity report as an XLSX workbook", () => {
    const workbook = read(activityReportToXlsx([reportRow]), { type: "buffer" });
    expect(workbook.SheetNames).toEqual(["Activities"]);

    const rows = utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Activities);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Date: "2026-08-04",
      "Start time": "18:00",
      "End time": "20:30",
      Tags: "geyser; heater",
      "Duration in minutes": 150,
      "Electricity usage in kWh": 5,
      "Average demand in kW": 2
    });
  });

  it("includes the XLSX header row when there are no activities", () => {
    const workbook = read(activityReportToXlsx([]), { type: "buffer" });
    const rows = utils.sheet_to_json<unknown[]>(workbook.Sheets.Activities, { header: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Water spend");
  });

  it("rounds raw floating-point sums to 2 decimal places in both formats, without stringifying numbers", () => {
    const messyRow: ActivityReportRow = {
      ...reportRow,
      electricityKwh: 0.81,
      averageKw: 0.37916666666666665,
      electricitySpend: 10.745,
      waterKl: 0.1506,
      waterSpend: 1.005
    };

    const csv = activityReportToCsv([messyRow]);
    expect(csv).not.toContain("0.37916666666666665");
    expect(csv.split("\n")[1]).toContain("0.38");

    const workbook = read(activityReportToXlsx([messyRow]), { type: "buffer" });
    const sheet = workbook.Sheets.Activities;
    const rows = utils.sheet_to_json<Record<string, unknown>>(sheet);
    const averageDemandCell = sheet[utils.encode_cell({ r: 1, c: 8 })];

    expect(rows[0]["Average demand in kW"]).toBe(0.38);
    expect(averageDemandCell.t).toBe("n");
    expect(typeof rows[0]["Average demand in kW"]).toBe("number");
  });
});
