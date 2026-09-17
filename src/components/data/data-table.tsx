"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { DataExportAction } from "@/components/data/data-export-action";
import { DataDetailDrawer } from "@/components/data/data-detail-drawer";
import { DataSyncAction } from "@/components/data/data-sync-action";
import { DropdownSelect, type DropdownOption } from "@/components/ui/dropdown-select";
import { MobileSortControls } from "@/components/ui/mobile-sort-controls";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { Skeleton } from "@/components/ui/skeleton";
import { type ChargeTypeFilter } from "@/lib/data-table-query-params";
import { dataTableColumnAlign, dataTableColumnLabel, dataTableColumns } from "./columns";
import { inferQuickRange } from "@/lib/filters";
import { useDataTableUrlState } from "@/lib/url-state/use-data-table-url-state";
import { formatCurrency } from "@/lib/format";
import { buildEnergyRowsUrl } from "@/lib/endpoints";
import type { EnergyRow, SyncMetadata } from "@/lib/types";
import { amountClassFor, amountDisplayFor, balanceClassFor, tariffDisplayFor, usageDisplayFor } from "./row-formatting";
import { DataCardSkeletonList } from "./data-card-skeleton-list";
import type { SortDirection, SortKey } from "./types";

const chargeTypeLabelMap: Record<EnergyRow["chargeKind"], string> = {
  energy: "Energy",
  water: "Water",
  fixed: "Fixed",
  topup: "Top up",
  refund: "Refund"
};

const SEARCH_DEBOUNCE_MS = 250;
const pageSizeOptions: DropdownOption[] = [
  { label: "25 / page", value: "25" },
  { label: "50 / page", value: "50" },
  { label: "100 / page", value: "100" }
];
const mobileSortOptions: DropdownOption[] = dataTableColumns.map((column) => ({
  label: column.label,
  value: column.id
}));

type EnergyRowsApiResponse = {
  rows: EnergyRow[];
  total: number;
  page: number;
  pageSize: number;
  sync: SyncMetadata;
  bounds: {
    from: string;
    to: string;
  };
};

function nextSortLabel(direction: SortDirection, active: boolean) {
  if (!active) {
    return <ArrowUpDown aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-muted/55" />;
  }

  return direction === "asc" ? (
    <ArrowUp aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-ink" />
  ) : (
    <ArrowDown aria-hidden="true" className="ml-1 h-3.5 w-3.5 text-ink" />
  );
}

async function fetchEnergyRows(params: URLSearchParams) {
  const response = await fetch(buildEnergyRowsUrl(params), { cache: "no-store" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Failed to load energy rows.");
  }

  return (await response.json()) as EnergyRowsApiResponse;
}

function TableSkeletonRows({ columnCount, rowCount }: { columnCount: number; rowCount: number }) {
  return (
    <>
      {Array.from({ length: rowCount }, (_, rowIndex) => (
        <tr key={`skeleton-${rowIndex}`}>
          {Array.from({ length: columnCount }, (_, columnIndex) => (
            <td className="px-4 py-3" key={`skeleton-${rowIndex}-${columnIndex}`}>
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Mobile-only stand-in for the table below <sm>: the same columns squeezed
// into a horizontally-scrollable table read badly on a phone (this is the
// widest table in the app, 8 columns), so this reads each row as a small
// card instead, no horizontal scroll at all. Reads straight from `rows`,
// not the TanStack column defs, since a card has no header/cell grid to
// flexRender, just a handful of fields in a fixed layout -- the same
// formatting helpers the desktop columns use (amountDisplayFor etc.) keep
// the numbers identical between the two views.
function DataRowCard({ onOpen, row }: { onOpen: () => void; row: EnergyRow }) {
  const usage = usageDisplayFor(row);
  const tariff = tariffDisplayFor(row);
  const hasUsage = row.usageUnit !== null;

  return (
    <button
      aria-label={`View details for ${chargeTypeLabelMap[row.chargeKind]} at ${row.periodDateTime.replace("T", " ")}`}
      className="flex w-full flex-col gap-1.5 px-4 py-3 text-left outline-none transition hover:bg-canvas/70 focus-visible:bg-canvas/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
      onClick={onOpen}
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink">{row.periodDateTime.replace("T", " ")}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="rounded bg-canvas px-2 py-1 text-xs font-medium uppercase tracking-[0.12em] text-muted">
            {chargeTypeLabelMap[row.chargeKind]}
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted/70" />
        </span>
      </div>

      {hasUsage ? (
        <p className="text-sm text-muted">
          {usage} @ {tariff}
          {row.tariffBand ? ` · ${row.tariffBand}` : ""}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <span className={amountClassFor(row)}>{amountDisplayFor(row)}</span>
        <span className="text-xs text-muted">
          Balance <span className={balanceClassFor(row.balance)}>{formatCurrency(row.balance)}</span> &middot;{" "}
          {row.captureDateTime}
        </span>
      </div>
    </button>
  );
}

export function DataTable({ isDemo = false }: { isDemo?: boolean }) {
  const {
    from,
    to,
    chargeType,
    searchQuery,
    page,
    pageSize,
    sortKey,
    sortDirection,
    isDatePending,
    isChargeTypePending,
    onDateChange,
    onQuickRange,
    onChargeTypeChange,
    onSearchChange,
    onSortChange,
    onSortKeyChange,
    onSortDirectionChange,
    onPageChange,
    onPageSizeChange
  } = useDataTableUrlState();
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [selectedRow, setSelectedRow] = useState<EnergyRow | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const closeDetailDrawer = useCallback(() => setSelectedRow(null), []);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();

    if (from) {
      params.set("from", from);
    }

    if (to) {
      params.set("to", to);
    }

    if (chargeType !== "all") {
      params.set("chargeType", chargeType);
    }

    if (searchQuery) {
      params.set("search", searchQuery);
    }

    if (sortKey !== "captured") {
      params.set("sort", sortKey);
    }

    if (sortDirection !== "desc") {
      params.set("dir", sortDirection);
    }

    if (page > 1) {
      params.set("page", String(page));
    }

    if (pageSize !== 50) {
      params.set("pageSize", String(pageSize));
    }

    return params;
  }, [chargeType, from, page, pageSize, searchQuery, sortDirection, sortKey, to]);

  const { data, isFetching, isLoading, error, refetch } = useQuery({
    queryKey: ["energy-rows", queryParams.toString()],
    queryFn: () => fetchEnergyRows(queryParams),
    placeholderData: keepPreviousData
  });

  const rows = data?.rows ?? [];
  const totalRows = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const displayFrom = from || data?.bounds.from || "";
  const displayTo = to || data?.bounds.to || "";
  const effectiveQuickRange = inferQuickRange(displayFrom, displayTo, data?.bounds);

  const handleQuickRangeChange = (
    range: "pastWeek" | "pastMonth" | "past3Months" | "thisMonth" | "thisWeek" | "allTime"
  ) => {
    if (range === "allTime") {
      const allTimeFrom = data?.bounds.from || "";
      const allTimeTo = data?.bounds.to || "";

      if (allTimeFrom && allTimeTo) {
        onDateChange(allTimeFrom, allTimeTo);
        return;
      }
    }

    onQuickRange(range);
  };

  const columns = useMemo<ColumnDef<EnergyRow>[]>(
    () => [
      {
        id: "period",
        accessorFn: (row) => row.periodDateTime,
        header: dataTableColumnLabel.period,
        cell: ({ row }) => <span className="font-medium text-ink">{row.original.periodDateTime.replace("T", " ")}</span>
      },
      {
        id: "type",
        accessorFn: (row) => row.chargeKind,
        header: dataTableColumnLabel.type,
        cell: ({ row }) => (
          <span className="rounded bg-canvas px-2 py-1 text-xs font-medium uppercase tracking-[0.12em] text-muted">
            {row.original.chargeKind}
          </span>
        )
      },
      {
        id: "band",
        accessorFn: (row) => row.tariffBand,
        header: dataTableColumnLabel.band,
        cell: ({ row }) => <span className="text-muted">{row.original.tariffBand ?? ""}</span>
      },
      {
        id: "kwh",
        accessorFn: (row) => row.usageAmount,
        header: dataTableColumnLabel.kwh,
        cell: ({ row }) => <span className="text-ink">{usageDisplayFor(row.original)}</span>
      },
      {
        id: "tariff",
        accessorFn: (row) => row.tariff,
        header: dataTableColumnLabel.tariff,
        cell: ({ row }) => <span className="text-muted">{tariffDisplayFor(row.original)}</span>
      },
      {
        id: "amount",
        accessorFn: (row) => row.cost,
        header: () => (
          <>
            <span className="sm:hidden">Amount</span>
            <span className="hidden sm:inline">{dataTableColumnLabel.amount}</span>
          </>
        ),
        cell: ({ row }) => <span className={amountClassFor(row.original)}>{amountDisplayFor(row.original)}</span>
      },
      {
        id: "balance",
        accessorFn: (row) => row.balance,
        header: dataTableColumnLabel.balance,
        cell: ({ row }) => (
          <span className={balanceClassFor(row.original.balance)}>{formatCurrency(row.original.balance)}</span>
        )
      },
      {
        id: "captured",
        accessorFn: (row) => row.captureDateTime,
        header: dataTableColumnLabel.captured,
        cell: ({ row }) => <span className="text-muted">{row.original.captureDateTime}</span>
      }
    ],
    []
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount,
    state: {
      pagination: {
        pageIndex: Math.max(0, page - 1),
        pageSize
      },
      sorting: [
        {
          id: sortKey,
          desc: sortDirection === "desc"
        }
      ]
    }
  });

  const chargeTypeOptions = useMemo<DropdownOption[]>(() => {
    return [
      { label: "All types", value: "all" },
      { label: chargeTypeLabelMap.energy, value: "energy" },
      { label: chargeTypeLabelMap.water, value: "water" },
      { label: chargeTypeLabelMap.fixed, value: "fixed" },
      { label: chargeTypeLabelMap.topup, value: "topup" },
      { label: chargeTypeLabelMap.refund, value: "refund" }
    ];
  }, []);

  const chargeTypeFilterControl = (
    <DropdownSelect
      ariaLabel="Charge type"
      value={chargeType}
      options={chargeTypeOptions}
      onChange={(value) => onChargeTypeChange(value as ChargeTypeFilter)}
      loading={isChargeTypePending}
      className="w-32"
      tone="dark"
    />
  );

  const searchFilterControl = (
    <div className="relative w-full sm:w-52">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
      <input
        aria-label="Search rows"
        className="h-9 w-full rounded-md border border-white/15 bg-white/10 pl-9 pr-3 text-sm text-white placeholder:text-white/50 outline-none focus:border-white/40"
        value={searchInput}
        onBlur={(event) => {
          if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
            searchDebounceRef.current = null;
          }

          onSearchChange(event.currentTarget.value);
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          setSearchInput(nextValue);

          if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
          }

          searchDebounceRef.current = setTimeout(() => {
            onSearchChange(nextValue);
          }, SEARCH_DEBOUNCE_MS);
        }}
        placeholder="Search"
      />
    </div>
  );

  const handleRefresh = async () => {
    setIsManualRefreshing(true);

    try {
      await refetch();
    } finally {
      setIsManualRefreshing(false);
    }
  };

  const refreshControl = (
    <button
      aria-label="Refresh rows"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sm text-muted transition enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isManualRefreshing}
      onClick={() => {
        void handleRefresh();
      }}
      type="button"
      title="Refresh rows"
    >
      <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isManualRefreshing ? "animate-spin" : ""}`} />
    </button>
  );

  const desktopRefreshControl = <div className="hidden sm:block">{refreshControl}</div>;
  const mobileRefreshControl = <div className="sm:hidden">{refreshControl}</div>;
  const hasPreviousPage = page > 1;
  const hasNextPage = page < pageCount;
  const showTableSkeleton = isLoading || isManualRefreshing;
  const skeletonRowCount = Math.min(pageSize, 12);

  useEffect(() => {
    const boundsFrom = data?.bounds.from || "";
    const boundsTo = data?.bounds.to || "";

    if (from || to || !boundsFrom || !boundsTo) {
      return;
    }

    onDateChange(boundsFrom, boundsTo);
  }, [data?.bounds.from, data?.bounds.to, from, onDateChange, to]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 pt-6 lg:gap-5">
      <FilterBar
        from={displayFrom}
        to={displayTo}
        quickRange={effectiveQuickRange}
        onDateChange={onDateChange}
        onQuickRange={handleQuickRangeChange}
        loading={isDatePending}
        leftControls={<DataSyncAction isDemo={isDemo} lastSyncedAt={data?.sync.lastSyncedAt} loading={isLoading} />}
        extraControls={chargeTypeFilterControl}
        rightControls={
          <div className="flex items-center gap-2">
            {searchFilterControl}
            <DataExportAction iconOnly={false} />
          </div>
        }
        fullBleed
      />

      {/* Not the shared Card component here -- its rounded-lg/border are
          hardcoded ahead of any className override, which would fight this
          section's own mobile-vs-desktop responsive overrides at equal
          specificity. On mobile the table breaks out to the full screen
          width (matching FilterBar's own fullBleed breakout) and drops its
          border/radius so it reads as one continuous surface directly under
          the filter bar, restored back to a normal bordered card at lg+. */}
      <section className="-mx-3 flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-line bg-paper sm:-mx-6 lg:mx-0 lg:rounded-lg lg:border">
        <div className="relative min-h-0 flex-1">
          {/* Below sm: one card per row, no horizontal scroll. At sm+: the
              full table, unchanged. Two renderings of the same `rows`, not
              a shared component, this table's columns don't generalize to
              the other two tables' very different shapes (see the earlier
              discussion on not merging them). */}
          <div className="flex h-full min-h-0 flex-col sm:hidden">
            <MobileSortControls
              direction={sortDirection}
              onDirectionChange={onSortDirectionChange}
              onSortKeyChange={onSortKeyChange}
              options={mobileSortOptions}
              sortKey={sortKey}
            />
            <div className="min-h-0 flex-1 overflow-auto">
              {showTableSkeleton ? (
                <DataCardSkeletonList count={skeletonRowCount} />
              ) : (
                <div className="divide-y divide-line">
                  {rows.map((row, index) => (
                    <DataRowCard
                      key={`${row.periodDateTime}-${row.chargeLabel}-${index}`}
                      onOpen={() => setSelectedRow(row)}
                      row={row}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="hidden h-full overflow-auto sm:block" ref={tableScrollRef}>
            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
              <thead className="sticky top-0 z-10 border-b border-line bg-accentSoft text-xs uppercase tracking-[0.16em] text-brandTeal dark:text-accent shadow-[0_1px_0_rgb(var(--color-line))]">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const id = header.column.id as SortKey;
                      const alignClass = dataTableColumnAlign[id] ?? "text-left";
                      const isActive = sortKey === id;

                      return (
                        <th className={`px-4 py-3 ${alignClass}`} key={header.id}>
                          <button
                            className="inline-flex items-center font-medium uppercase tracking-[0.16em]"
                            onClick={() => onSortChange(id)}
                            type="button"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {nextSortLabel(sortDirection, isActive)}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-line">
                {showTableSkeleton ? (
                  <TableSkeletonRows columnCount={columns.length} rowCount={skeletonRowCount} />
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr
                      aria-label={`View details for ${chargeTypeLabelMap[row.original.chargeKind]} at ${row.original.periodDateTime.replace("T", " ")}`}
                      className="cursor-pointer transition hover:bg-canvas/70 focus-visible:bg-canvas/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-accent/50"
                      key={row.id}
                      onClick={() => setSelectedRow(row.original)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedRow(row.original);
                        }
                      }}
                      tabIndex={0}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const alignClass = dataTableColumnAlign[cell.column.id] ?? "text-left";

                        return (
                          <td className={`px-4 py-3 ${alignClass}`} key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="hidden sm:block">
            <ScrollHint containerRef={tableScrollRef} />
          </div>
        </div>

        {/* Mobile drops the row count and shortens "Page X of Y" to "X/Y" --
            short enough that everything now fits back on one row like
            desktop, no more flex-col split needed. desktopRefreshControl/
            mobileRefreshControl already self-hide via their own wrapper
            (hidden sm:block / sm:hidden), so placing one at the front of the
            button cluster and the other at the back gets the "refresh moves
            to the far side on mobile" swap for free, no extra responsive
            logic required. */}
        <div className="shrink-0 flex items-center justify-between gap-2 border-t border-line px-3 py-3">
          <p className="text-sm text-muted">
            <span className="sm:hidden">
              {Math.min(page, pageCount)} of {pageCount}
            </span>
            <span className="hidden sm:inline">
              Page {Math.min(page, pageCount)} of {pageCount}
              {!isLoading ? ` \u00b7 ${totalRows} rows` : ""}
              {isFetching && !isLoading ? " \u00b7 updating..." : ""}
            </span>
          </p>
          <div className="flex items-center gap-2">
            {desktopRefreshControl}
            <DropdownSelect
              ariaLabel="Rows per page"
              value={String(pageSize)}
              options={pageSizeOptions}
              onChange={(value) => onPageSizeChange(Number(value))}
              menuPlacement="top"
              className="w-32"
            />
            <button
              aria-label="Previous page"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-paper text-muted transition enabled:hover:bg-canvas enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!hasPreviousPage}
              onClick={() => onPageChange(page - 1)}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              aria-label="Next page"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-paper text-muted transition enabled:hover:bg-canvas enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!hasNextPage}
              onClick={() => onPageChange(page + 1)}
              type="button"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
            {mobileRefreshControl}
          </div>
        </div>

        {error instanceof Error ? <p className="px-3 py-2 text-sm text-red-500">{error.message}</p> : null}
      </section>

      {selectedRow ? <DataDetailDrawer onClose={closeDetailDrawer} row={selectedRow} /> : null}
    </div>
  );
}
