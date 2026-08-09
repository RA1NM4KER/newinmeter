import { formatTariffForUnit, formatUsage } from "@/lib/format";
import type { EnergyRow } from "@/lib/types";

export function amountClassFor(row: EnergyRow) {
  if (row.chargeKind === "topup" || row.chargeKind === "refund") {
    return "font-medium text-success";
  }

  if (row.chargeKind === "fixed") {
    return "font-medium text-fixed";
  }

  return "text-ink";
}

export function usageDisplayFor(row: EnergyRow) {
  return formatUsage(row.usageAmount, row.usageUnit);
}

export function tariffDisplayFor(row: EnergyRow) {
  return formatTariffForUnit(row.tariff, row.usageUnit);
}
