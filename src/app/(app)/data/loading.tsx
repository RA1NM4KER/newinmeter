"use client";

import { Search } from "lucide-react";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { dataTableColumns } from "@/components/data/columns";
import { DataExportAction } from "@/components/data/data-export-action";
import { DataSyncAction } from "@/components/data/data-sync-action";
import { DropdownSelect } from "@/components/ui/dropdown-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDataTableUrlState } from "@/lib/use-data-table-url-state";

const chargeTypeOptions = [
  { label: "All types", value: "all" },
  { label: "Energy", value: "energy" },
  { label: "Water", value: "water" },
  { label: "Fixed", value: "fixed" },
  { label: "Top up", value: "topup" }
];

export default function DataLoading() {
  const {
    from,
    to,
    quickRange,
    chargeType,
    searchQuery,
    isDatePending,
    isChargeTypePending,
    onDateChange,
    onQuickRange,
    onChargeTypeChange
  } = useDataTableUrlState();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 pt-6 lg:gap-5">
      <FilterBar
        from={from}
        to={to}
        quickRange={quickRange}
        onDateChange={onDateChange}
        onQuickRange={onQuickRange}
        loading={isDatePending}
        leftControls={<DataSyncAction loading />}
        extraControls={
          <DropdownSelect
            ariaLabel="Charge type"
            value={chargeType}
            options={chargeTypeOptions}
            onChange={(value) => onChargeTypeChange(value as typeof chargeType)}
            loading={isChargeTypePending}
            className="w-32"
            tone="dark"
          />
        }
        rightControls={
          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-52">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
              <input
                aria-label="Search rows"
                className="h-9 w-full rounded-md border border-white/15 bg-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/50 outline-none focus:border-white/40"
                defaultValue={searchQuery}
                placeholder="Search"
                disabled
              />
            </div>
            <DataExportAction iconOnly={false} />
          </div>
        }
        fullBleed
      />

      <section className="-mx-3 flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line bg-paper sm:-mx-6 lg:mx-0 lg:rounded-lg lg:border">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-line bg-accentSoft text-xs uppercase tracking-[0.16em] text-brandTeal dark:text-accent shadow-[0_1px_0_rgb(var(--color-line))]">
              <tr>
                {dataTableColumns.map((column) => (
                  <th className={`px-4 py-3 font-medium ${column.align}`} key={column.id}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {Array.from({ length: 12 }, (_, rowIndex) => (
                <tr key={rowIndex}>
                  {dataTableColumns.map((column) => (
                    <td className="px-4 py-3" key={column.id}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-line px-3 py-3">
          <Skeleton className="h-4 w-16 sm:w-40" />
          <div className="flex items-center gap-2">
            <Skeleton className="hidden h-9 w-9 rounded-md sm:block" />
            <Skeleton className="h-9 w-32 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md sm:hidden" />
          </div>
        </div>
      </section>
    </div>
  );
}
