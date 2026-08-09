import { formatCurrency, formatTariffForUnit, formatUsage } from "@/lib/format";
import type { EnergyRow } from "@/lib/types";

// Top-ups and refunds are both credits (money in) and both raise the balance,
// so display them as a positive amount -- matching LiveMopay. A refund is stored
// as a negative cost so it reduces net spend in the totals; the green colour and
// the REFUND/Top up type already signal that it's a credit, so the minus sign is
// dropped here to avoid showing two credits with opposite signs.
export function amountDisplayFor(row: EnergyRow) {
  const isCredit = row.chargeKind === "topup" || row.chargeKind === "refund";
  return formatCurrency(isCredit ? Math.abs(row.cost) : row.cost);
}

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
