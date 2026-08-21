"use client";

import { ExportButton } from "@/components/ui/export-button";
import { useDataTableUrlState } from "@/lib/url-state/use-data-table-url-state";

type DataExportActionProps = {
  iconOnly?: boolean;
};

export function DataExportAction({ iconOnly = true }: DataExportActionProps) {
  const { from, to, chargeType, searchQuery, sortKey, sortDirection } = useDataTableUrlState();

  // Always rendered inside the filter bar's rightControls, so it always
  // sits on the bar's dark teal background -- no other caller in this
  // codebase.
  return (
    <ExportButton
      from={from || undefined}
      to={to || undefined}
      chargeType={chargeType !== "all" ? chargeType : undefined}
      search={searchQuery || undefined}
      sort={sortKey !== "captured" ? sortKey : undefined}
      dir={sortDirection !== "desc" ? sortDirection : undefined}
      iconOnly={iconOnly}
      tone="dark"
    />
  );
}
