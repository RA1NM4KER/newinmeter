import { consumptionPeriodLabel } from "@/lib/consumption-period";
import type { EnergyRow } from "@/lib/types";

export function periodLabelFor(row: Pick<EnergyRow, "periodDateTime" | "chargeKind">) {
  return consumptionPeriodLabel(row.periodDateTime, row.chargeKind === "energy" || row.chargeKind === "water" ? 30 : 0);
}

export function PeriodLabel({ row }: { row: Pick<EnergyRow, "periodDateTime" | "chargeKind"> }) {
  const { label, accessibleLabel } = periodLabelFor(row);
  return (
    <span title={accessibleLabel} aria-label={accessibleLabel}>
      {label}
    </span>
  );
}
