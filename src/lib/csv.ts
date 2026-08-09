import type { EnergyRow } from "./types";
export type EnergyRecordInput = {
  capture_dt: string;
  charge_label: string;
  period_dt: string;
  kwh: string | number;
  water_kl?: string | number;
  tariff: string | number;
  cost: string | number;
  balance: string | number;
};
function parseCaptureDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);

  if (!match) {
    return new Date(value);
  }

  const [, day, month, year, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function parsePeriodDate(value: string) {
  return new Date(value.replace(" ", "T"));
}

function toNumber(value: string | number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function toEnergyRow(row: EnergyRecordInput): EnergyRow {
  const periodDt = parsePeriodDate(row.period_dt);
  const captureDt = parseCaptureDate(row.capture_dt);
  const periodDateTime = row.period_dt.replace(" ", "T");
  const chargeKind = row.charge_label.startsWith("Energy Charge:")
    ? "energy"
    : row.charge_label.startsWith("Water:")
      ? "water"
      : row.charge_label === "Top Up"
        ? "topup"
        : /refund/i.test(row.charge_label)
          ? "refund"
          : "fixed";
  const waterKl = toNumber(row.water_kl ?? 0);
  const usageAmount = chargeKind === "water" ? waterKl : chargeKind === "energy" ? toNumber(row.kwh) : 0;
  const usageUnit = chargeKind === "water" ? "kL" : chargeKind === "energy" ? "kWh" : null;

  return {
    chargeKind,
    captureTimestamp: captureDt.getTime(),
    captureDateTime: row.capture_dt,
    ledgerTimestamp: chargeKind === "topup" || chargeKind === "refund" ? periodDt.getTime() : captureDt.getTime(),
    chargeLabel: row.charge_label,
    periodTimestamp: periodDt.getTime(),
    periodDateTime,
    periodDate: periodDateTime.slice(0, 10),
    periodTime: periodDateTime.slice(11, 16),
    hour: periodDt.getHours(),
    kwh: toNumber(row.kwh),
    waterKl,
    usageAmount,
    usageUnit,
    tariff: toNumber(row.tariff),
    cost: toNumber(row.cost),
    balance: toNumber(row.balance)
  };
}
