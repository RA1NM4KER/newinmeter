import { getBalanceTone } from "@/components/dashboard/metric-cards";
import { formatCurrency, formatTariffForUnit, formatUsage } from "@/lib/format";
import type { EnergyRow } from "@/lib/types";

// Same thresholds as the dashboard's own "Latest balance" metric card
// (getBalanceTone, src/components/dashboard/metric-cards.ts), reused rather
// than redefined so "is this balance low" agrees everywhere. Colours differ
// from that card on purpose for "good": text-success (the same green as a
// top-up/credit in this same table, see amountClassFor) reads more clearly
// as "healthy balance" in a column full of money amounts than the
// dashboard's own accent teal would here.
const balanceToneClass = {
  good: "text-success",
  watch: "text-amber-700 dark:text-amber-400",
  danger: "text-red-700 dark:text-red-400"
} as const;

export function balanceClassFor(balance: number) {
  return balanceToneClass[getBalanceTone(balance)];
}

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

export function transactionSummaryFor(row: EnergyRow) {
  const amount = amountDisplayFor(row);

  if (row.chargeKind === "topup") {
    return `${amount} was added to the meter balance.`;
  }

  if (row.chargeKind === "refund") {
    return `${amount} was returned to the meter balance.`;
  }

  if (row.chargeKind === "fixed") {
    return `A fixed charge of ${amount} was applied.`;
  }

  return `${usageDisplayFor(row)} was charged at ${tariffDisplayFor(row)}.`;
}

export function dataDateTimeDisplayFor(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return value;

  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

export function meterEntryDisplayFor(row: EnergyRow) {
  const normalizedEntry = row.chargeLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const redundantLabels: Record<EnergyRow["chargeKind"], string[]> = {
    energy: ["energy", "energy charge"],
    water: ["water", "water charge"],
    fixed: ["fixed", "fixed charge"],
    topup: ["top up", "topup"],
    refund: ["refund"]
  };

  return redundantLabels[row.chargeKind].includes(normalizedEntry) ? null : row.chargeLabel;
}

export function tariffBandDisplayFor(tariffBand: string | null) {
  if (!tariffBand) return "Not specified";

  const numericRange = tariffBand.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  return numericRange ? `Block ${numericRange[1]}–${numericRange[2]}` : tariffBand;
}
